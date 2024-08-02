# About this package
This package is an opinionated framework based on Express that takes care of the requirements commonly 
found in back end APIs, letting you focus on developing features that makes your application unique.

## Features at a glance
* User authentication and management
* Logging and configurations
* User preferences
* Email notifications via Sendgrid

## Getting started
After [forking](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/fork-a-repo) from this repository, install necessary libraries:
```shell
nvm install
nvm use
npm install
```
Also define a `.env` file at the package root (ie `app-stack/packages/api/.env`) with following initial variables:
```shell
PLATFORM_DB_URL="file:/var/data/app.db"
JWT_SECRET="<some random string>"
```

You can then run the application by `npm run dev`. You should see the application running on port 3000

### Implementing your first endpoint
Go to `src/extensions` directory and create a typescript file:
``` shell
cd src/extensions
touch helloWorld.ts
```
Edit `helloWorld.ts` with the following code snippet:

```typescript
import { Service } from '../platform/plugin';

export function init(this: Service) {
  this.useEndpoint('get', '/hello', (req, res) => {
    res.status(200).json({
      status: 'ok',
    });
  });
}
```
This creates the endpoint `GET http://localhost:3000/api/hello`. If you try calling it with your
browser, you will see a `401 Unauthorized` response, that's because access to all API endpoints by 
default must be authenticated. To open the endpoint to unauthenticated users, add `withAuthentication(null)`:
```typescript
import { Service } from '../platform/plugin';

export function init(this: Service) {
  this.useEndpoint('get', '/hello', (req, res) => {
    res.status(200).json({
      message: 'hello world'
    });
  }).withAuthentication(null);
}
```
Congraduations, you have just created your first `extension`. Keep reading to understand more about extensions and
how they work in the grand scheme of things.

## Platform and Services
Noticed how you've just defined what effectively is an Express endpoint without directly invoking Express? That's because
your code is a `service` running in a sandbox (admittedly, a very porous one) environment provided by the package. As the name of the directory suggests,
your code is an extension to a platform constructed by the code residing in `src/platform`.

**WARNING: Do not modify code in `platform/` directory. Doing so you risk losing compatibility with future versions of the
framework.**

Let's take a look at what's involved in defining an `extension`. In its simplest form, an extension is simply a 
typescript file with an exported function named `init()`. The `init` function is typed `Service` which gives you access
to functions to:
* Register handlers for RESTful endpoints
* Register handlers for web socket connections
* Schedule background tasks
* Access to a logger tagged for this service

If we re-visit the `helloWorld` extension again:
```typescript
import { Service } from '../platform/plugin';

var someVar = 'some constants';
function justANormalFunction() {}

export function init(this: Service) {
  this.useEndpoint('get', '/hello', (req, res) => {
    res.status(200).json({
      message: 'hello world'
    });
  }).withAuthentication(null);
}

export function anotherNormalFunction() {}
```
We see that we have an exported `init()` function that registers a function as the handler to a service
endpoint `GET /hello`. 

**Note: The actual endpoint available is `GET /api/hello`, that's because the platform 
encourages all endpoints to be organised under a sub-path (`/api`) rather than `/` which simplifies deployment later on.
The value `/api` can be modified by changing `app.apiRoot` in the file `config/default.yaml`**

That is all there is to an extension. You are free to define functions and variables outside the `init()` function just 
as any other node.js files. The extensions pattern encourages you to organise your code such that related code are grouped
as feature-centric services  but it does not hinder you from calling other services through the normal means of node.js import.

### Everything is a service
You may be confused between the term `extension` and `service`. These terms have been used interchangably in this document
because everything is a service. Extensions are services defined by application developers while there are services defined
within the platform that provides foundational features such as authentication and user management. They both function the
same way, the distinction is only made in order keep them in different namespaces within the platform to avoid collision.

### Lifecycle of a service
A service exists in one of the 5 states:
1. INITIALISED
2. STARTING
3. STARTED
4. STOPPING
5. STOPPED

`src/main.ts` is the entry point of the application. By importing `platform` in `main.ts`, the platform will scan the 
`extensions` folder (and its sub-directories) and identifies all services to be loaded. Each service' `init()` function is
invoked once, resulting in the service being in the `INITIALIZED` state. At this point, the service is simply configured 
but it's not active yet.

When the platform starts via the `platform.start()` call, all initialized services will undergo the start up process where
the lifecycle status transitions to `STARTING`. All registered handlers and background jobs registered in the `init()` 
function are brought to live. If there was an `onStart` callback registered, the callback is invoked at this point. After
the execution of `onStarted` callback, the service is transitioned into the `STARTED` state.
 
A running service may be stopped, either individually or together as a group as the application exits. When a service stops,
its lifecycle status is set to `STOPPING`. If there was a `onStopping` callback defined in the `init()` function, it will be called,
follow by a removal of handlers from API endpoints and websocket routes. When the all handlers and background tasks are removed, 
the service is transitioned into a `STOPPED` state.

### Service dependencies
There may be times where you will need one service to start after another. In order to achieve this, the `init()` function
may optionally return an array of service IDs to indicate that it is dependent on the referenced services. 

Each service is automatically assigned an ID corresponding to the path of the file relative to `extensions` folder

#### Example
The service defined in `src/extensions/hello.ts` will have the ID `hello` by default. 
The service defined in `src/extensions/world/hello.ts` will have the ID `world/hello`.

The service ID can be altered by calling `this.setId()` inside `init()`.

**Note: All platform services have their IDs as `platform/<name>`**

## Platform features
More documentation soon....