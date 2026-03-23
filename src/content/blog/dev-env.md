---
title: "Dev env commands and tips"
pubDate: 2020-10-13
category: "Private"
tags: ["dev"]
author: "Nagarajan"
description: ""
legacySlug: "dev-env"
disqusIdentifier: "dev_env_tips"
---
<h4>Fix for the git ssh identity issue </h4>

```bash
# kill existing ssh-agents
pkill -9 -f ssh-agent

# restart ssh-agent
eval "$(ssh-agent -s)"

# add the ssh key to the agent
ssh-add ~/.ssh/id_gh_nagarajan

# test ssh connection
ssh -T git@github.com
```

<h4>Move files on the web server to the nginx public folder</h4>

```bash
# cd to the right folder
cd dev/motleytechpy3

# copy files
git pull; sudo cp -r output/* /var/www/motleytech/html
```
