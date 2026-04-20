# 📈 SentimentAlgoTraderStack
**A Polyglot Event-Driven Trading Pipeline**

A serverless system built with **AWS CDK (TypeScript)** that ingests financial news, performs sentiment analysis using **DeepSeek-R1 (Python)**, and executes paper trades via the **Alpaca API**.

---

## 🏗 System Architecture

The architecture is designed for cost-efficiency and security, utilizing a **Dual-Environment** strategy to bypass the $35/month NAT Gateway fee.

### The "Bridge" Pattern
1.  **Internet-Facing (Outside VPC):** High I/O tasks that need free public internet (TypeScript Ingestor).
2.  **Internal-Secure (Inside VPC):** Data-heavy tasks that need private access to the RDS database (Python Analyzer).

---

## 📦 Package Directory

### 1. `infra/` (AWS CDK - TypeScript)
The "Brain" of the infrastructure. Defines the entire AWS estate.
* **VPC:** Custom 2-AZ network with Public and Isolated subnets (0 NAT Gateways).
* **Database:** RDS PostgreSQL (`db.t4g.micro`) sitting in an Isolated subnet.
* **Security Groups:** Strictly defined ingress/egress rules between Lambdas and RDS.
* **SQS Queue:** The language-agnostic bridge between the TS Ingestor and Python Analyzer.

### 2. `packages/api-ingestor` (TypeScript Lambda)
* **Role:** The "Collector."
* **Runtime:** Node.js 20.x.
* **Network:** Runs outside the VPC (Free internet access).
* **Logic:** Polls Alpha Vantage `NEWS_SENTIMENT`, filters for new articles, and pushes JSON payloads to SQS.

### 3. `packages/ml-analyzer` (Python Lambda)
* **Role:** The "Brain."
* **Runtime:** Python 3.11.
* **Network:** Runs inside the VPC (Private access to RDS).
* **Logic:** Consumes messages from SQS. Uses **DeepSeek-R1** (via API) to score sentiment. Saves results to the `news_sentiment` table in Postgres.

### 4. `packages/dashboard` (Next.js - App Router)
* **Role:** The "Command Center."
* **Logic:** Displays real-time sentiment trends, active trades from Alpaca, and the system’s equity curve.
* **Database:** Connects directly to RDS via the VPC using Prisma/Drizzle.

---

## 🔄 Data Flow
1.  **Trigger:** `AWS EventBridge` fires a Cron job every 15 minutes.
2.  **Ingest:** `api-ingestor` (TS) fetches news → pushes to `SQS`.
3.  **Analyze:** `ml-analyzer` (Python) wakes up from SQS trigger → calls `DeepSeek` → writes to `RDS`.
4.  **Visualize:** `dashboard` (Next.js) reads from `RDS` to display the "Alpha."

---

## 🛠 Tech Stack Summary
* **IaC:** AWS CDK (v2)
* **Languages:** TypeScript, Python 3.11
* **Database:** PostgreSQL 16 (RDS)
* **AI:** DeepSeek-R1
* **Trading API:** Alpaca Markets
* **UI:** Next.js, Tailwind CSS

---

## 🚀 Commands
* `npx cdk deploy`: Deploys the entire infrastructure.
* `npx cdk synth`: Inspects the generated CloudFormation template.
* `npx ts-node packages/api-ingestor/test-local.ts`: Runs the ingestor logic on your laptop.

---

> **Note on Environment Variables:**
> Sensitive keys (Alpha Vantage, DeepSeek) are managed via **AWS Secrets Manager** and injected into Lambdas at deployment or fetched at runtime.
