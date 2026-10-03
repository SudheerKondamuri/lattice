targetScope = 'resourceGroup'

@description('Container Registry image for the API image built from backend/.')
param apiImage string
@description('Container Registry image for the worker image. Use the same image with the worker command.')
param workerImage string
param frontendImage string
param environmentName string = 'lattice-production'
param logWorkspaceName string = 'lattice-logs'
param apiAppName string = 'lattice-api'
param workerAppName string = 'lattice-worker'
@description('Public frontend origin used by backend CORS, widget origin checks and billing return URLs.')
param frontendOrigin string
param supabaseUrl string
param supabaseStorageBucket string = 'lattice-originals'
param azureOpenAIEndpoint string
param azureOpenAIApiVersion string = '2024-10-21'
param azureAnswerDeployment string
param azureGradingDeployment string
param azureEmbeddingDeployment string

@secure()
param databaseUrl string
@secure()
param migrationDatabaseUrl string
@secure()
param supabaseAnonKey string
@secure()
param supabaseServiceRoleKey string
@secure()
param azureOpenAIApiKey string
@secure()
param resendApiKey string = ''
param emailFrom string = ''
@allowed(['true', 'false'])
param emailDeliveryEnabled string = 'false'
@secure()
param stripeSecretKey string = ''
@secure()
param stripeWebhookSecret string = ''
param stripeStarterPriceId string = ''
param stripeGrowthPriceId string = ''
@allowed(['true', 'false'])
param billingEnabled string = 'false'

resource logs 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logWorkspaceName
  location: resourceGroup().location
  properties: {
    retentionInDays: 30
    sku: { name: 'PerGB2018' }
  }
}

resource environment 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: environmentName
  location: resourceGroup().location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: { customerId: logs.properties.customerId, sharedKey: logs.listKeys().primarySharedKey }
    }
  }
}

var commonSecrets = [
  { name: 'database-url'; value: databaseUrl }
  { name: 'migration-database-url'; value: migrationDatabaseUrl }
  { name: 'supabase-anon-key'; value: supabaseAnonKey }
  { name: 'supabase-service-role-key'; value: supabaseServiceRoleKey }
  { name: 'azure-openai-api-key'; value: azureOpenAIApiKey }
  { name: 'resend-api-key'; value: resendApiKey }
  { name: 'stripe-secret-key'; value: stripeSecretKey }
  { name: 'stripe-webhook-secret'; value: stripeWebhookSecret }
]

var commonEnvironment = [
  { name: 'DATABASE_URL'; secretRef: 'database-url' }
  { name: 'MIGRATION_DATABASE_URL'; secretRef: 'migration-database-url' }
  { name: 'APP_ORIGIN'; value: frontendOrigin }
  { name: 'SUPABASE_URL'; value: supabaseUrl }
  { name: 'SUPABASE_ANON_KEY'; secretRef: 'supabase-anon-key' }
  { name: 'SUPABASE_SERVICE_ROLE_KEY'; secretRef: 'supabase-service-role-key' }
  { name: 'SUPABASE_STORAGE_BUCKET'; value: supabaseStorageBucket }
  { name: 'AI_PROVIDER'; value: 'azure' }
  { name: 'AZURE_OPENAI_ENDPOINT'; value: azureOpenAIEndpoint }
  { name: 'AZURE_OPENAI_API_KEY'; secretRef: 'azure-openai-api-key' }
  { name: 'AZURE_OPENAI_API_VERSION'; value: azureOpenAIApiVersion }
  { name: 'AZURE_OPENAI_ANSWER_DEPLOYMENT'; value: azureAnswerDeployment }
  { name: 'AZURE_OPENAI_GRADING_DEPLOYMENT'; value: azureGradingDeployment }
  { name: 'AZURE_OPENAI_EMBEDDING_DEPLOYMENT'; value: azureEmbeddingDeployment }
  { name: 'EMAIL_DELIVERY_ENABLED'; value: emailDeliveryEnabled }
  { name: 'BILLING_ENABLED'; value: billingEnabled }
  { name: 'RESEND_API_KEY'; secretRef: 'resend-api-key' }
  { name: 'EMAIL_FROM'; value: emailFrom }
  { name: 'STRIPE_SECRET_KEY'; secretRef: 'stripe-secret-key' }
  { name: 'STRIPE_WEBHOOK_SECRET'; secretRef: 'stripe-webhook-secret' }
  { name: 'STRIPE_STARTER_PRICE_ID'; value: stripeStarterPriceId }
  { name: 'STRIPE_GROWTH_PRICE_ID'; value: stripeGrowthPriceId }
  { name: 'TRUST_PROXY'; value: 'false' }
]

resource api 'Microsoft.App/containerApps@2023-05-01' = {
  name: apiAppName
  location: resourceGroup().location
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      secrets: commonSecrets
      ingress: { external: true, targetPort: 4000, transport: 'http', allowInsecure: false }
    }
    template: {
      containers: [{
        name: 'api'
        image: apiImage
        resources: { cpu: 1, memory: '2Gi' }
        env: concat(commonEnvironment, [
          { name: 'PORT'; value: '4000' }
          { name: 'HOST'; value: '0.0.0.0' }
        ])
      }]
      scale: { minReplicas: 1, maxReplicas: 3, rules: [{ name: 'http', http: { metadata: { concurrentRequests: '50' } } }] }
    }
  }
}

resource worker 'Microsoft.App/containerApps@2023-05-01' = {
  name: workerAppName
  location: resourceGroup().location
  properties: {
    managedEnvironmentId: environment.id
    configuration: { activeRevisionsMode: 'Single', secrets: commonSecrets }
    template: {
      containers: [{
        name: 'worker'
        image: workerImage
        command: ['node', 'dist/backend/src/worker.js']
        resources: { cpu: 2, memory: '5Gi' }
        env: concat(commonEnvironment, [{ name: 'WORKER_CONCURRENCY'; value: '2' }])
      }]
      scale: { minReplicas: 1, maxReplicas: 2 }
    }
  }
}

resource frontend 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'lattice-web'
  location: resourceGroup().location
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 3000, transport: 'http', allowInsecure: false }
    }
    template: {
      containers: [{
        name: 'web'
        image: frontendImage
        resources: { cpu: 0.5, memory: '1Gi' }
        env: [{ name: 'BACKEND_API_ORIGIN', value: 'https://${api.properties.configuration.ingress.fqdn}' }]
      }]
      scale: { minReplicas: 1, maxReplicas: 3, rules: [{ name: 'http', http: { metadata: { concurrentRequests: '50' } } }] }
    }
  }
}

output apiFqdn string = api.properties.configuration.ingress.fqdn
output frontendFqdn string = frontend.properties.configuration.ingress.fqdn
