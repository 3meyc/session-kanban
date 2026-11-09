#!/bin/sh
# Prints "<app session id> <count>" for each idle session whose background shells
# or agents are still running. The app reports such a session as not running.
#
# Each live Claude Code process keeps ~/.claude/sessions/<pid>.json, which names
# the app's session id and the CLI session whose transcript records the tasks: a
# launch (backgroundTaskId, or an agent's async_launched) and its end (a
# <task-id> notification, or a TaskStop, which sends none). Only launches since
# the process started count, so tasks a closed process took with it are not.

sessions="$HOME/.claude/sessions"
projects="$HOME/.claude/projects"
# A task's start and end both write to the transcript, so a count stays right
# while the transcript keeps its size and time; large ones take a second to scan.
cache="${TMPDIR:-/tmp}/session-kanban-tasks"
mkdir -p "$cache" 2>/dev/null

field() {
  printf '%s' "$1" | sed -n "s/.*\"$2\":\"\{0,1\}\([^\",}]*\).*/\1/p"
}

for record_file in "$sessions"/*.json; do
  [ -f "$record_file" ] || continue
  record=$(cat "$record_file")
  case $record in *'"status":"idle"'*) ;; *) continue ;; esac
  pid=$(field "$record" pid)
  host=$(field "$record" hostSessionId)
  cli=$(field "$record" sessionId)
  started=$(field "$record" startedAt)
  [ -n "$pid" ] && [ -n "$host" ] && [ -n "$cli" ] && [ -n "$started" ] || continue
  kill -0 "$pid" 2>/dev/null || continue
  since=$(date -u -r $((started / 1000)) +%Y-%m-%dT%H:%M:%S)
  for transcript in "$projects"/*/"$cli".jsonl; do
    [ -f "$transcript" ] || continue
    key="$started $(stat -f '%z %m' "$transcript")"
    saved=$(cat "$cache/$cli" 2>/dev/null)
    if [ "${saved% *}" = "$key" ]; then
      count=${saved##* }
      [ "${count:-0}" -gt 0 ] && echo "$host $count"
      continue
    fi
    count=$(grep -F -e '"backgroundTaskId":"' -e '"async_launched"' -e '<task-id>' -e 'stopped task: ' -e '"name":"TaskStop"' "$transcript" |
      awk -v since="$since" '
        function after(text, mark,   rest) {
          rest = substr(text, index(text, mark) + length(mark))
          match(rest, /^[A-Za-z0-9_-]+/)
          return substr(rest, 1, RLENGTH)
        }
        {
          stamp = ""
          if (match($0, /"timestamp":"[^"]*"/)) stamp = substr($0, RSTART + 13, RLENGTH - 14)
          if (stamp >= since && index($0, "\"backgroundTaskId\":\"")) launched[after($0, "\"backgroundTaskId\":\"")] = 1
          if (stamp >= since && index($0, "\"status\":\"async_launched\"") && index($0, "\"agentId\":\"")) launched[after($0, "\"agentId\":\"")] = 1
          rest = $0
          while ((at = index(rest, "<task-id>")) > 0) {
            rest = substr(rest, at + 9)
            match(rest, /^[A-Za-z0-9_-]+/)
            ended[substr(rest, 1, RLENGTH)] = 1
          }
          if (index($0, "stopped task: ")) ended[after($0, "stopped task: ")] = 1
          if (index($0, "\"name\":\"TaskStop\"") && index($0, "\"task_id\":\"")) ended[after($0, "\"task_id\":\"")] = 1
        }
        END { n = 0; for (id in launched) if (id != "" && !(id in ended)) n++; print n }')
    printf '%s %s\n' "$key" "${count:-0}" > "$cache/$cli" 2>/dev/null
    [ "${count:-0}" -gt 0 ] && echo "$host $count"
  done
done
exit 0
