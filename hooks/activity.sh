#!/bin/sh
# Reads app session ids (local_…) from stdin, one per line, and prints
# "<app session id> <hour>=<count> …": how many transcript entries the session
# wrote in each UTC hour (YYYY-MM-DDTHH) from $1 on. Sessions with none print nothing.
#
# The app's own record of a session names the CLI session whose transcript holds
# the entries (cliSessionId), and the one its last reply came from; a resumed
# session can have both. The record is the app's private file, not an API.

since=$1
records="$HOME/Library/Application Support/Claude/claude-code-sessions"
projects="$HOME/.claude/projects"
# Counts per hour stay right while a transcript keeps its size and time; a
# large one takes a second to scan, and a board refresh asks every 30 seconds.
cache="${TMPDIR:-/tmp}/session-kanban-activity"
mkdir -p "$cache" 2>/dev/null

# "<hour> <count>" lines for one transcript, from the cache when it is unchanged.
hours_of() {
  transcript=$1
  name=$(basename "$transcript" .jsonl)
  key=$(stat -f '%z %m' "$transcript")
  if [ "$(head -n 1 "$cache/$name" 2>/dev/null)" = "$key" ]; then
    tail -n +2 "$cache/$name"
    return
  fi
  # The first timestamp on a line is the entry's own; later ones are quoted content.
  counted=$(awk 'match($0, /"timestamp":"[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]/) { print substr($0, RSTART + 13, 13) }' "$transcript" |
    sort | uniq -c | awk '{ print $2, $1 }')
  printf '%s\n%s\n' "$key" "$counted" > "$cache/$name" 2>/dev/null
  printf '%s\n' "$counted"
}

while read -r host; do
  case $host in local_*) ;; *) continue ;; esac
  for record_file in "$records"/*/*/"$host.json"; do
    [ -f "$record_file" ] || continue
    clis=$(grep -o -e '"cliSessionId":"[^"]*"' -e '"lastAssistantCliSessionId":"[^"]*"' "$record_file" | cut -d '"' -f 4 | sort -u)
    for cli in $clis; do
      for transcript in "$projects"/*/"$cli".jsonl; do
        [ -f "$transcript" ] && hours_of "$transcript"
      done
    done | awk -v host="$host" -v since="$since" '
      $1 >= since && $2 > 0 { count[$1] += $2 }
      END {
        line = ""
        for (hour in count) line = line " " hour "=" count[hour]
        if (line != "") print host line
      }'
  done
done
exit 0
