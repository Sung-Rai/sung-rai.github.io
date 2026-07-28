# Sung-Rai.github.io Portfolio

**Live site:** [https://sung-rai.github.io/index.html/](https://sung-rai.github.io/index.html)

## About this repository

This repository contains the source code for my GitHub Pages website. Each project should try to be kept as in its own folder.

## Project structure

Update this example to match the repository ```cmd //c tree```:

```text
├───Index
|
├───.github
│   └───workflows
├───KeamKxN
│   ├───css
│   ├───data
│   ├───js
│   └───sql
└───KeamN
    ├───css
    └───js
```

Keep project-specific files inside that project's folder. Put a file in a shared folder only when it is genuinely used by more than one project.

### Branching workflow

The default branch, `main`, should always remain deployable. Do not commit directly to `main`.

1. Synchronize your local `main` branch:

   ```bash
   git switch main
   git pull origin main
   ```

2. Create a branch from the latest `main`:

   ```bash
   git switch -c PROJECT-NAME/TYPE/DESCRIPTION
   ```

   Use one of these branch types:

   - `feat/` (new feature for the user, not a new feature for build script)
   - `fix/` (bug fix for the user, not a fix to a build script)
   - `docs/` (changes to the documentation)
   - `style/` (formatting, missing semi colons, etc; no production code change)
   - `refactor/` (refactoring production code, eg. renaming a variable)
   - `chore/` (updating grunt tasks etc; no production code change)
   
   Example:

   ```text
   KeamKxN/fix/broken-login-button
   Index/docs/update-readme
   ```

3. Push your branch and open a pull request:

   ```bash
   git push -u origin YOUR-BRANCH-NAME
   ```

Delete the branch after it has been merged.

## Reporting problems

Open an issue detailing:

- the affected page or project;
- steps to reproduce the problem;
- the expected and actual behavior;
- screenshots and browser/device details when useful.
