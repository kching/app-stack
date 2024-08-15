# About

This repository aims to provide the foundational pieces to your next project. By addressing concerns
commonly found in web-based applications, you will be able to focus on building the components that
matter to you the most.

## How to use this codebase?
It is recommended that you fork this repository into a new repository and build your project in the newly
created repository. This way you will be able to pull in future changes without causing too much drama.

## Repository layout
The code base consists of two sub-projects in the form of `npm workspace`s:
* `pacakges/api` - Services and back end logic for your application
* `packages/web` - Foundational user interface for you to extend upon

Each package contains a `readme.md` that further discusses the intricacies of the package in greater detail.

## Deployment
The goal for this project is to allow developers to rapidly build and deploy their applications. As such the deployment
model is intentionally chosen to be functional as a stand-alone unit. This allows developers to simply upload an image to
any docker-compliant hosting platform and run it with minimal friction.

(TODO: More relating to deploying soon)