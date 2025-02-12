# Config-Server
This server is the API for MapColonies configuration management system. It is responsible for managing the configuration of the services in the system.

## Schemas package
The server depends on the [schemas package](https://github.com/MapColonies/schemas) to load and validate the configuration schemas. The schemas package is a separate package and the server should be updated when a new version of the schemas package is released.

## Development
To run the server locally the following steps are required.

1. Clone the repository
```bash
git clone git@github.com:MapColonies/config-server.git
```
2. Install the dependencies
```bash
npm install
```
3. create a local configuration file under the config folder named `local.json` and fill it with the required configuration. Check the `config/default.json` file for the required configuration.
4. Run the migrations
```bash
npm run migration:run
```
5. Run the server
```bash
npm run start:dev
```

### Creating a new migration
To create a new migration file run the following command:
```bash
npm run migration:create
```

## Testing
To run the tests run the following command:
```bash
npm run test
```
Make sure you have set the testing configuration.

## Deployment
The server is deployed using docker and a helm chart. To build the docker image run the following command:
```bash
docker build -t <your-org>/config-server:<tag> .
```

If needed, it's possible to run the migrations straight from the docker image by running the following command:
```bash
docker run --rm <your-org>/config-server:<tag> node ./db/runMigrations.js
```
Don't forget to set the required environment variables.
