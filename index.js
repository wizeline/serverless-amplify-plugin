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

  amplifyVariableResolver(src) {
    return src.slice('amplify:'.length)
  }

  addAmplify() {
    const { service } = this.serverless
    const { custom, provider, serviceObject } = service
    const { amplify } = custom
    const { defaultBuildSpecOverrides = {} } = amplify
    const {
      baseDirectory = 'dist'
    } = defaultBuildSpecOverrides
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
      commands:
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: ${baseDirectory}
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*`,
    } = amplify
    const { Resources, Outputs } = provider.compiledCloudFormationTemplate
    const namePascalCase = pascalCase(name)
    Resources[`${namePascalCase}AmplifyApp`] = {
      Type: 'AWS::Amplify::App',
      Properties: {
        Name: name,
        Repository: repository,
        AccessToken: accessToken,
        BuildSpec: buildSpec
      }
    }

    Resources[`${namePascalCase}AmplifyBranch`] = {
      Type: 'AWS::Amplify::Branch',
      Properties: {
        AppId: { 'Fn::GetAtt': [`${namePascalCase}AmplifyApp`, 'AppId'] },
        BranchName: branch,
        EnableAutoBuild: enableAutoBuild,
        Stage: stage
      }
    }

    if (domainName) {
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

    Outputs[[`${namePascalCase}AmplifyDefaultDomain`]] = {
      "Value": {
        "Fn::Sub": `\${${namePascalCase}AmplifyBranch.BranchName}.\${${namePascalCase}AmplifyApp.DefaultDomain}`
      }
    }
  }
}

module.exports = ServerlessAmplifyPlugin