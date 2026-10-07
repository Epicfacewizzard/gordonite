#!/usr/bin/env bash
# Runs ON THE CASAOS SERVER (sent by scripts/deploy-casaos.ps1 -Inspect). Read-only: changes nothing.
# Prints image and container names, which Compose file the running container came from, and whether that file
# mentions the assistant key (a yes/no, never the value).
set -u
COMPOSE=/home/gordon/gordonite/deploy/gordonite-casaos.yml
sudo -v || exit 1

echo "== images (repository:tag  id  created)"
sudo docker images --format '{{.Repository}}:{{.Tag}}  {{.ID}}  {{.CreatedSince}}' | head -20

echo; echo "== containers"
sudo docker ps -a --format '{{.Names}}  image={{.Image}}  {{.Status}}' | head -20

echo; echo "== the gordonite container"
sudo docker inspect gordonite --format 'image name: {{.Config.Image}}{{"\n"}}image id:   {{.Image}}{{"\n"}}compose project: {{index .Config.Labels "com.docker.compose.project"}}{{"\n"}}compose file:    {{index .Config.Labels "com.docker.compose.project.config_files"}}{{"\n"}}working dir:     {{index .Config.Labels "com.docker.compose.project.working_dir"}}' 2>&1

echo; echo "== $COMPOSE (names only)"
if [ -f "$COMPOSE" ]; then
  grep -n -E '^name:|^  [A-Za-z0-9_-]+:$|image:|container_name:|env_file:|published:|ports:' "$COMPOSE" | head -30
  printf 'lines mentioning ASSISTANT_TOKEN (not commented out): %s\n' "$(grep -v '^[[:space:]]*#' "$COMPOSE" | grep -c ASSISTANT_TOKEN)"
else
  echo "(file not found)"
fi

echo; echo "== other compose files near it"
ls -la /home/gordon/gordonite/deploy/ 2>&1 | head -20
echo; echo "== the app"
curl -s http://127.0.0.1:8082/api/health; echo
