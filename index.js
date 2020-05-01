const { pascalCase } = require('pascal-case')

class ServerlessAmplifyPlugin {
  constructor(serverless, options) {
    this.serverless = serverless
    this.options = options
    this.hooks = {
      'before:package:finalize': () => this.addAmplify(),
    }
    this.variableResolvers = {
      amplify: {
        resolver: this.amplifyVariableResolver,
        isDisabledAtPrepopulation: true,
        serviceName: 'serverless-amplify..'
      }
    }
  }

  addAmplifyResources() {
    const { service } = this.serverless
    const { custom, provider, serviceObject } = service
    const { amplify } = custom
    const { buildSpecValues = {} } = amplify
    const {
      artifactBaseDirectory = 'dist',
      artifactFiles = ['**/*'],
      preBuildWorkingDirectory
    } = buildSpecValues
    const preBuildCommands = getPreBuildCommands(preBuildWorkingDirectory)

    const {
      repository,
      accessTokenSecretName = 'AmplifyGithub',
      accessTokenSecretKey = 'accessToken',
      accessToken = `{{resolve:secretsmanager:${accessTokenSecretName}:SecretString:${accessTokenSecretKey}}}`,
      branch = 'master',
      domainName,
      enableAutoBuild = true,
      redirectNakedToWww = false,
      name = serviceObject.name,
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
    const { Resources, Outputs } = provider.compiledCloudFormationTemplate
    const namePascalCase = pascalCase(name)

    addBaseResourcesAndOutputs({
      Resources,
      Outputs,
      name,
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
}

function addBaseResourcesAndOutputs({
  Resources,
  name,
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
      Repository: repository,
      AccessToken: accessToken,
      BuildSpec: buildSpec
    }
  }

  Outputs[[`${namePascalCase}AmplifyDefaultDomain`]] = {
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
  const cdWorkingDirectoryCommand = preBuildWorkingDirectory ? `cd ${preBuildWorkingDirectory}` : null
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