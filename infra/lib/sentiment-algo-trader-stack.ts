import 'dotenv/config';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as triggers from 'aws-cdk-lib/triggers';
import { FckNatInstanceProvider } from 'cdk-fck-nat';
import * as lambdaPython from '@aws-cdk/aws-lambda-python-alpha';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';

export class SentimentAlgoTraderStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly database: rds.DatabaseInstance;
  public readonly apiIngestor: lambda.Function;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const natGatewayProvider = new FckNatInstanceProvider({
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      // Add this block to fix the architecture mismatch
      machineImage: new ec2.LookupMachineImage({
        name: 'fck-nat-al2023-*-x86_64-ebs', // Note the x86_64 here
        owners: ['568608671756'], // Official fck-nat owner ID
      }),
    });

    this.vpc = new ec2.Vpc(this, 'TradingVpc', {
      maxAzs: 2,
      natGateways: 1,
      natGatewayProvider: natGatewayProvider,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // 2. Security Groups
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for RDS PostgreSQL',
      allowAllOutbound: true,
    });

    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Trading Lambdas',
      allowAllOutbound: true, // Needed to call Alpha Vantage / DeepSeek
    });

    // Add this after your fck-nat provider is defined
    natGatewayProvider.connections.allowFrom(lambdaSecurityGroup, ec2.Port.allTraffic());
    natGatewayProvider.securityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.allTraffic(),
      'Allow Lambda to send traffic through fck-nat'
    );
    natGatewayProvider.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
    );
    natGatewayProvider.role.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['ssm:StartSession'],
      resources: ['*'],
    }));
    // Explicitly allow the NAT Security Group to send traffic to the DB
    natGatewayProvider.securityGroup.addEgressRule(
      dbSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow NAT instance to send queries to RDS'
    );

    // Allow Lambdas to talk to the DB
    dbSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL access from Lambda'
    );
    dbSecurityGroup.addIngressRule(
      natGatewayProvider.securityGroup, // Allow the NAT instance SG
      ec2.Port.tcp(5432),
      'Allow PostgreSQL access from NAT Instance (SSM Tunnel)'
    );

    // 3. RDS Instance (Standard RDS - Free Tier Eligible)
    this.database = new rds.DatabaseInstance(this, 'PostgresDb', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MICRO,
      ),
      vpc: this.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [dbSecurityGroup],
      databaseName: 'tradingdb',
      credentials: rds.Credentials.fromGeneratedSecret('dbadmin', {
        secretName: 'rds-credentials',
      }),
      allocatedStorage: 20,
      maxAllocatedStorage: 50,
      storageType: rds.StorageType.GP3,
      removalPolicy: cdk.RemovalPolicy.DESTROY, 
      deletionProtection: false,
    });

    const newsQueue = new sqs.Queue(this, 'NewsQueue', {
      visibilityTimeout: cdk.Duration.seconds(300), // 5 minutes for the LLM to process
      encryption: sqs.QueueEncryption.KMS_MANAGED,
    });

    new cdk.CfnOutput(this, 'QueueUrl', {
      value: newsQueue.queueUrl,
    });

    this.apiIngestor = new NodejsFunction(this, 'IngestorHandler', {
      entry: 'packages/api-ingestor/index.ts',
      handler: 'handler',
      vpc: this.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [lambdaSecurityGroup], 
      environment: {
        QUEUE_URL: newsQueue.queueUrl, 
        ALPHA_VANTAGE_KEY: process.env.ALPHA_VANTAGE_KEY || 'default_if_missing',
        DB_HOST: this.database.dbInstanceEndpointAddress,
        DB_NAME: 'tradingdb',
        SECRET_ID: 'rds-credentials',
      },
    });

    const dbInitialiser = new NodejsFunction(this, 'DbInitialiser', {
      entry: 'infra/lib/db-initialiser/index.ts', // Make sure this path exists
      handler: 'handler',
      vpc: this.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [lambdaSecurityGroup], // Use your existing SG
      environment: {
        DB_HOST: this.database.dbInstanceEndpointAddress,
        DB_NAME: 'tradingdb',
        SECRET_ID: 'rds-credentials',
      },
      bundling: {
        forceDockerBundling: false, // Fast local builds
        externalModules: ['aws-sdk'], 
      },
      timeout: cdk.Duration.minutes(2),
    });

    this.database.secret?.grantRead(dbInitialiser);

    new triggers.Trigger(this, 'ExecuteDbInitialiser', {
      handler: dbInitialiser,
      invocationType: triggers.InvocationType.REQUEST_RESPONSE,
      timeout: cdk.Duration.minutes(2),
    });

    const mlAnalyser = new lambdaPython.PythonFunction(this, 'MlAnalyser', {
      entry: 'packages/ml-analyser', // Directory with your code and requirements.txt
      runtime: lambda.Runtime.PYTHON_3_11,
      index: 'handler.py',
      handler: 'handler',
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSecurityGroup],
      timeout: cdk.Duration.minutes(5), // CRITICAL: DeepSeek-R1 reasoning takes time
      memorySize: 512, // Pandas/OpenAI SDK can be memory hungry
      environment: {
        DB_HOST: this.database.dbInstanceEndpointAddress,
        DB_USER: 'dbadmin', // Hardcoding user is fine, keeps it clear
        DB_PASSWORD: this.database.secret!.secretValueFromJson('password').toString(), // Use .toString()
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
      },
      bundling: {
        assetExcludes: [
          '**/.venv',
          '**/__pycache__',
          '**/.env',
          '**/node_modules',
        ]
      }
    })
    this.database.secret?.grantRead(mlAnalyser);
    mlAnalyser.addEnvironment('DB_PASSWORD', 
      this.database.secret?.secretValueFromJson('password').unsafeUnwrap()!
    );

    mlAnalyser.addEventSource(new lambdaEventSources.SqsEventSource(newsQueue, {
      batchSize: 5, // Process 5 articles at a time
      maxBatchingWindow: cdk.Duration.seconds(30),
    }));
  }
}