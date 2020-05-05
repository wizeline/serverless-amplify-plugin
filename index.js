const util = require('util')
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')
const archiver = require('archiver')
const { pascalCase } = require('pascal-case')
const { put } = require('request-promise')
const ora = require('ora')

class ServerlessAmplifyPlugin {
  constructor(serverless, options) {
    this.serverless = serverless
    this.options = options
    this.hooks = {
      'before:package:finalize': async () => {
        this.setAmplifyOptions()
        this.namePascalCase = pascalCase(this.amplifyOptions.name)
        this.addAmplifyResources()

        if (!this.amplifyOptions.isManual) return

        this.zipFilePath = '.serverless/ui.zip'

        const credentials = new this.serverless.providers.aws.sdk.SharedIniFileCredentials({ profile: this.serverless.getProvider('aws').getProfile() })
        const amplifyClient = new this.serverless.providers.aws.sdk.Amplify({
          region: this.serverless.getProvider('aws').getRegion(),
          credentials
        })

        this.amplifyClient = amplifyClient
        await this.describeStack({ isPackageStep: true })

        const stackExists = Boolean(this.amplifyAppId)

        // If the stack exists, package and create the deployment
        // During the package step, then execute the deployment
        // During the CloudFormation deployment
        if (stackExists) {
          await this.packageWeb()
          const { jobId } = await createAmplifyDeployment({
            amplifyClient,
            appId: this.amplifyAppId,
            branchName: this.amplifyOptions.branch,
            zipFilePath: this.zipFilePath
          })
          this.amplifyDeploymentJobId = jobId
        }
      },
      // TODO:
      // If this is a stack update, deploy to Amplify *during* deployment
      // instead of after so that it doesn't wait for rollback window
      'after:deploy:deploy': () => this.amplifyOptions.isManual && this.deployWeb(),
      'after:rollback:initialize': () => this.amplifyOptions.isManual && this.rollbackAmplify()
    }
    // this.commands = {
    //   deploy: {
    //     lifecycleEvents: ['deploy'],
    //   },
    // }
    this.variableResolvers = {
      amplify: {
        resolver: amplifyVariableResolver,
        isDisabledAtPrepopulation: true,
        serviceName: 'serverless-amplify..'
      }
    }
  }

  setAmplifyOptions() {
    const { serverless } = this
    const { service } = serverless
    const { custom, serviceObject } = service
    const { amplify } = custom
    const { buildSpecValues = {} } = amplify
    const {
      artifactBaseDirectory = 'dist',
      artifactFiles = ['**/*'],
      preBuildWorkingDirectory = '.'
    } = buildSpecValues
    const preBuildCommands = getPreBuildCommands(preBuildWorkingDirectory)

    const {
      repository,
      accessTokenSecretName = 'AmplifyGithub',
      accessTokenSecretKey = 'accessToken',
      accessToken = `{{resolve:secretsmanager:${accessTokenSecretName}:SecretString:${accessTokenSecretKey}}}`,
      branch = 'master',
      isManual = false,
      enableAutoBuild = !isManual,
      domainName,
      redirectNakedToWww = false,
      name = serviceObject.name,
      buildCommandEnvVars = {},
      stage = 'PRODUCTION',
      buildSpec = `version: 0.1
frontend:
  phases:
    preBuild:
      commands:${preBuildCommands}
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: ${artifactBaseDirectory}
    files:${getArtifactFilesYaml(artifactFiles)}
  cache:
    paths:
      - node_modules/**/*`,
    } = amplify

    buildCommandEnvVars.prefix = buildCommandEnvVars.prefix || ''
    buildCommandEnvVars.allow = buildCommandEnvVars.allow || []

    this.amplifyOptions = {
      repository,
      accessTokenSecretName,
      accessTokenSecretKey,
      accessToken,
      branch,
      isManual,
      domainName,
      enableAutoBuild,
      redirectNakedToWww,
      name,
      stage,
      buildSpec,
      artifactBaseDirectory,
      preBuildWorkingDirectory,
      buildCommandEnvVars
    }
  }

  packageWeb() {
    return new Promise((resolve, reject) => {
      const envVars = {}
      const { buildCommandEnvVars } = this.amplifyOptions
      const allowedOutputs = this.outputs
        .filter(output => buildCommandEnvVars.allow.includes(output.OutputKey))

      allowedOutputs.forEach(output => {
        envVars[`${buildCommandEnvVars.prefix}${output.OutputKey}`] = output.OutputValue
      })

      const command = 'npm run build'
      let args = command.split(/\s+/);
      const cmd = args[0];
      args = args.slice(1);
      const baseDirectory = path.join(this.serverless.config.servicePath, this.amplifyOptions.preBuildWorkingDirectory)
      const execution = spawn(cmd, args, {
        cwd: baseDirectory,
        env: {
          ...process.env,
          ...envVars
        },
        stdio: 'inherit'
      })
      execution.on('exit', (code) => {
        if (code === 0) {
          const zipSpinner = ora()
          zipSpinner.start(`Zipping to ${this.zipFilePath}...`)
          const output = fs.createWriteStream(this.zipFilePath);
          const buildDirectory = this.amplifyOptions.artifactBaseDirectory
          const archive = archiver('zip');
          output.on('close', () => {
            zipSpinner.succeed('UI zip created!')
            resolve(this.zipFilePath);
          });

          archive.on('error', (err) => {
            zipSpinner.fail(err)
            reject(err);
          });
          archive.pipe(output);
          archive.directory(buildDirectory, false);
          archive.finalize();
        } else {
          reject(code);
        }
      });
    });
  }

  async describeStack({ isPackageStep }) {
    const describeStackSpinner = ora()
    const stackName = util.format('%s-%s',
      this.serverless.service.getServiceName(),
      this.serverless.getProvider('aws').getStage()
    )
    describeStackSpinner.start('Getting stack outputs...')
    let stacks
    try {
      stacks = await this.serverless.getProvider('aws').request(
        'CloudFormation',
        'describeStacks',
        { StackName: stackName },
        this.serverless.getProvider('aws').getStage(),
        this.serverless.getProvider('aws').getRegion()
      )
    } catch (error) {
      if (isPackageStep) {
        describeStackSpinner.succeed(`Couldn't get stack ${stackName}. It might not yet exist.`)
      } else {
        describeStackSpinner.fail(`Couldn't get stack ${stackName}`)
      }
      return
    }
    const stack = stacks.Stacks[0]
    const { Outputs } = stack
    this.outputs = Outputs
    const amplifyDefualtDomainOutputKey = getAmplifyDefaultDomainOutputKey(this.namePascalCase)
    const amplifyDefualtDomainOutput = Outputs.find(output => output.OutputKey === amplifyDefualtDomainOutputKey)
    const amplifyDefualtDomainParts = amplifyDefualtDomainOutput.OutputValue.split('.')
    const amplifyAppId = amplifyDefualtDomainParts[1]

    describeStackSpinner.succeed(`Got Amplify App ID: ${amplifyAppId}`)

    this.amplifyAppId = amplifyAppId
  }

  async deployWeb() {
    if (!this.amplifyDeploymentJobId) {
      await this.describeStack({ isPackageStep: false })

      await this.packageWeb()
      const { jobId } = await createAmplifyDeployment({
        amplifyClient: this.amplifyClient,
        appId: this.amplifyAppId,
        branchName: this.amplifyOptions.branch,
        zipFilePath: this.zipFilePath,
      })
      this.amplifyDeploymentJobId = jobId
    }

    return publishFileToAmplify({
      appId: this.amplifyAppId,
      branchName: this.amplifyOptions.branch,
      jobId: this.amplifyDeploymentJobId,
      amplifyClient: this.amplifyClient,
    })
  }

  addAmplifyResources() {
    const { namePascalCase, serverless } = this
    const { service } = serverless
    const { provider } = service
    const { Resources, Outputs } = provider.compiledCloudFormationTemplate
    const {
      repository,
      accessToken,
      branch,
      isManual,
      domainName,
      enableAutoBuild,
      redirectNakedToWww,
      name,
      stage,
      buildSpec,
    } = this.amplifyOptions

    addBaseResourcesAndOutputs({
      Resources,
      Outputs,
      name,
      isManual,
      repository,
      accessToken,
      buildSpec,
      namePascalCase,
    })

    if (branch) {
      addBranch({
        Resources,
        namePascalCase,
        branch,
        enableAutoBuild,
        stage
      })
    }

    if (domainName) {
      addDomainName({
        Resources,
        Outputs,
        redirectNakedToWww,
        namePascalCase,
        domainName
      })
    }
  }
  rollbackAmplify() { }
}

async function createAmplifyDeployment({
  amplifyClient,
  appId,
  branchName,
  zipFilePath
}) {
  const createAmplifyDeploymentSpinner = ora()
  createAmplifyDeploymentSpinner.start('Creating Amplify Deployment...')
  try {
    const params = {
      appId,
      branchName,
    }

    await cancelAllPendingJob(appId, branchName, amplifyClient)
    const { zipUploadUrl, jobId } = await amplifyClient
      .createDeployment(params)
      .promise()
    createAmplifyDeploymentSpinner.succeed('Amplify Deployment created!')
    const uploadToS3Spinner = ora()
    uploadToS3Spinner.start('Uploading UI package to S3...')
    await httpPutFile(zipFilePath, zipUploadUrl)
    uploadToS3Spinner.succeed('UI Package uploaded to S3!')
    return { jobId }
  } catch (error) {
    createAmplifyDeploymentSpinner.fail('Failed creating Amplify Deployment')
    throw error
  }
}

async function publishFileToAmplify({
  appId,
  branchName,
  jobId,
  amplifyClient,
}) {
  const DEPLOY_ARTIFACTS_MESSAGE = 'Deploying build artifacts to the Amplify Console..'
  const DEPLOY_COMPLETE_MESSAGE = 'Deployment complete!'
  const DEPLOY_FAILURE_MESSAGE = 'Deployment failed!'

  const publishSpinner = ora()
  try {
    const params = {
      appId,
      branchName,
    }
    publishSpinner.start(DEPLOY_ARTIFACTS_MESSAGE)
    await amplifyClient.startDeployment({ ...params, jobId }).promise()
    await waitJobToSucceed({ ...params, jobId }, amplifyClient)
    publishSpinner.succeed(DEPLOY_COMPLETE_MESSAGE)
  } catch (err) {
    publishSpinner.fail(DEPLOY_FAILURE_MESSAGE)
    throw err
  }
}

async function cancelAllPendingJob(appId, branchName, amplifyClient) {
  const params = {
    appId,
    branchName,
  };
  const { jobSummaries } = await amplifyClient.listJobs(params).promise();
  for (const jobSummary of jobSummaries) {
    const { jobId, status } = jobSummary;
    if (status === 'PENDING' || status === 'RUNNING') {
      const job = { ...params, jobId };
      await amplifyClient.stopJob(job).promise();
    }
  }
}

function waitJobToSucceed(job, amplifyClient) {
  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      console.log('Job Timeout before succeeded');
      reject();
    }, 1000 * 60 * 10);
    let processing = true;
    try {
      while (processing) {
        const getJobResult = await amplifyClient.getJob(job).promise();
        const jobSummary = getJobResult.job.summary;
        if (jobSummary.status === 'FAILED') {
          console.log(`Job failed.${JSON.stringify(jobSummary)}`);
          clearTimeout(timeout);
          processing = false;
          resolve();
        }
        if (jobSummary.status === 'SUCCEED') {
          clearTimeout(timeout);
          processing = false;
          resolve();
        }
        await sleep(1000 * 3);
      }
    } catch (err) {
      processing = false;
      reject(err);
    }
  });
}

function sleep(ms) {
  return new Promise((resolve, reject) => {
    try {
      setTimeout(resolve, ms);
    } catch (err) {
      reject(err);
    }
  });
}

async function httpPutFile(filePath, url) {
  await put({
    body: fs.readFileSync(filePath),
    url,
  });
}

function getAmplifyDefaultDomainOutputKey(namePascalCase) {
  return `${namePascalCase}AmplifyDefaultDomain`
}

function addBaseResourcesAndOutputs({
  Resources,
  name,
  isManual,
  repository,
  accessToken,
  buildSpec,
  Outputs,
  namePascalCase,
}) {
  Resources[`${namePascalCase}AmplifyApp`] = {
    Type: 'AWS::Amplify::App',
    Properties: {
      Name: name,
      BuildSpec: buildSpec
    }
  }

  if (!isManual) {
    Resources[`${namePascalCase}AmplifyApp`].Properties.Repository = repository
    Resources[`${namePascalCase}AmplifyApp`].Properties.AccessToken = accessToken
  }

  Outputs[getAmplifyDefaultDomainOutputKey(namePascalCase)] = {
    "Value": {
      "Fn::Sub": `\${${namePascalCase}AmplifyBranch.BranchName}.\${${namePascalCase}AmplifyApp.DefaultDomain}`
    }
  }
}

function addBranch({
  Resources,
  namePascalCase,
  branch,
  enableAutoBuild,
  stage
}) {
  Resources[`${namePascalCase}AmplifyBranch`] = {
    Type: 'AWS::Amplify::Branch',
    Properties: {
      AppId: { 'Fn::GetAtt': [`${namePascalCase}AmplifyApp`, 'AppId'] },
      BranchName: branch,
      EnableAutoBuild: enableAutoBuild,
      Stage: stage
    }
  }
}

function addDomainName({
  Resources,
  Outputs,
  redirectNakedToWww,
  namePascalCase,
  domainName
}) {

  if (redirectNakedToWww) {
    Resources[`${namePascalCase}AmplifyApp`].Properties.CustomRules = {
      Source: `https://${domainName}`,
      Target: `https://www.${domainName}`,
      Status: "302"
    }
  }

  Resources[`${namePascalCase}AmplifyDomain`] = {
    Type: 'AWS::Amplify::Domain',
    Properties: {
      DomainName: domainName,
      AppId: { 'Fn::GetAtt': [`${namePascalCase}AmplifyApp`, 'AppId'] },
      SubDomainSettings: [
        {
          Prefix: '',
          BranchName: { 'Fn::GetAtt': [`${namePascalCase}AmplifyBranch`, 'BranchName'] }
        }
      ]
    }
  }

  Outputs[`${namePascalCase}AmplifyBranchUrl`] = {
    "Value": {
      "Fn::Sub": `\${${namePascalCase}AmplifyBranch.BranchName}.\${${namePascalCase}AmplifyDomain.DomainName}`
    }
  }
}


function amplifyVariableResolver(src) {
  return src.slice('amplify:'.length)
}

function getArtifactFilesYaml(artifactFiles) {
  return artifactFiles
    .map(artifactFile => `
      - '${artifactFile}'`)
    .join('')
}

function getPreBuildCommands(preBuildWorkingDirectory) {
  const cdWorkingDirectoryCommand = preBuildWorkingDirectory && preBuildWorkingDirectory !== '.' ? `cd ${preBuildWorkingDirectory}` : null
  const commands = [
    cdWorkingDirectoryCommand,
    'npm ci'
  ]
  return commands
    .filter(command => command)
    .map(command => `
        - ${command}`)
    .join('')
}

module.exports = ServerlessAmplifyPlugin