# Wizeline Serverless Amplify Plugin - Basic Example

This example showcases how to get a basic website up and running with AWS Amplify Console, Serverless Framework, and the Wizeline Serverless Amplify Plugin.

## Running the example

Clone the https://github.com/wizeline/serverless-amplify-plugin repository:

```shell
git clone https://github.com/wizeline/serverless-amplify-plugin
```

Create a new GitHub repository and push the contents of this example directory as the root.

Update `serverless.yaml` by replacing `https://github.com/YOUR_GIT_USER/YOUR_GIT_REPO` with your new GitHub repository's URL.

```shell
npm i
```

Create a GitHub Personal Access Token with `repo` scope and store it as a secret in AWS Secrets Manager:

```shell
aws secretsmanager create-secret --name AmplifyGithub --secret-string '{"accessToken":"YOUR_GITHUB_PERSONAL_ACCESS_TOKEN"}'
```



## How was this example created?

This example was created by running create-react-app and adding the `serverless.yaml` file.