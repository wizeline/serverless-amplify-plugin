# Wizeline Serverless Amplify Plugin - Basic Example

This example showcases how to get a basic website up and running with AWS Amplify Console, Serverless Framework, and the Wizeline Serverless Amplify Plugin.

## Building the example

This example is so simple, it's easier to build it from scratch than clone it yourself!

1. Create a new GitHub repository and clone it to your local machine
2. Create a GitHub Personal Access Token with `repo` scope and store it as a secret in AWS Secrets Manager:
    ```shell
    aws secretsmanager create-secret --name AmplifyGithub --secret-string '{"accessToken":"YOUR_GITHUB_PERSONAL_ACCESS_TOKEN"}'
    ```
3. Run `npx create-react-app .`
4. Install serverless and @wizeline/serverless-amplify-plugin:
    ```shell
    npm i -D serverless @wizeline/serverless-amplify-plugin
    ```
5. Create a `serverless.yaml` file with the following:
    ```yaml
    service: wizeline-serverless-amplify-plugin-basic-example
    provider:
      name: aws
    plugins:
      - @wizeline/serverless-amplify-plugin

    custom:
      amplify:
        repository: https://github.com/YOUR_GIT_USER/YOUR_GIT_REPO
        # 👆 Change this to point to your new GitHub repository
        buildSpecValues:
          artifactBaseDirectory: build
          # 👆 create-react-app builds to a `build` directory instead of the default `dist`
    ```
6. Run `npx serverless deploy` 🚀
7. Run `serverless info -v` and copy-paste the `...DefaultDomain` output value into your browser 🎉