import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

export class SentimentAlgoTraderStack extends cdk.Stack {
  public readonly vpc: ec2.IVpc;
  public readonly database: rds.IDatabaseInstance;
  public readonly apiIngestor: lambda.IFunction;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. Cost-Optimized VPC (NAT Gateway: 0)
    this.vpc = new ec2.Vpc(this, 'TradingVpc', {
      maxAzs: 2,
      natGateways: 0, // KILL THE COST: Removes the ~$35/month fee
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public', // Lambdas go here to get free internet access
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Isolated', // Database stays here for maximum security
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
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

    // Allow Lambdas to talk to the DB
    dbSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL access from Lambda'
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
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
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
      environment: {
        QUEUE_URL: newsQueue.queueUrl, 
        ALPHA_VANTAGE_KEY: process.env.ALPHA_VANTAGE_KEY || 'default_if_missing'
      },
    });
  }
}