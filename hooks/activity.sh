#!/bin/sh
# Reads app session ids (local_…) from stdin, one per line, and prints for each:
#
#   hours <id> <hour>=<entries>,<tokens>,<output> …
#     per UTC hour (YYYY-MM-DDTHH) from $1 on: the transcript entries the
#     session wrote, the tokens its replies used (input, cache writes, cache
#     reads and output) and the output tokens alone. No line when none.
#   status <id> <category> <needs action>
#     the app's summary of the session's last turn, when it is about that turn
#     and is not "completed": blocked or review_ready, with the JSON-escaped
#     line saying what the session waits for (may be empty).
#
# The app's own record of a session names the CLI session whose transcript holds
# the entries (cliSessionId), and the one its last reply came from; a resumed
# session can have both. The record is the app's private file, not an API.

since=$1
# "status" as $2 prints only the status lines, without reading transcripts.
mode=${2:-all}
records="$HOME/Library/Application Support/Claude/claude-code-sessions"
projects="$HOME/.claude/projects"
# Counts per hour stay right while a transcript keeps its size and time; a
# large one takes a second to scan, and a board refresh asks every 30 seconds.
cache="${TMPDIR:-/tmp}/session-kanban-activity-2"
mkdir -p "$cache" 2>/dev/null

# "<hour> <entries> <tokens> <output>" lines for one transcript, from the cache
# when it is unchanged.
hours_of() {
  transcript=$1
  name=$(basename "$transcript" .jsonl)
  key=$(stat -f '%z %m' "$transcript")
  if [ "$(head -n 1 "$cache/$name" 2>/dev/null)" = "$key" ]; then
    tail -n +2 "$cache/$name"
    return
  fi
  # The first timestamp on a line is the entry's own; later ones are quoted
  # content. A reply is written once per content block, each line repeating
  # its message id and usage, so a message's tokens count once.
  counted=$(awk '
    function number(text, name,   at, rest) {
      at = index(text, "\"" name "\":")
      if (at == 0) return 0
      rest = substr(text, at + length(name) + 3)
      match(rest, /^[0-9]+/)
      return substr(rest, 1, RLENGTH) + 0
    }
    match($0, /"timestamp":"[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]/) {
      hour = substr($0, RSTART + 13, 13)
      entries[hour]++
      at = index($0, "\"usage\":{")
      if (at == 0) next
      id = ""
      if (match($0, /"id":"msg_[A-Za-z0-9]+"/)) id = substr($0, RSTART, RLENGTH)
      if (id != "" && (id in seen)) next
      seen[id] = 1
      usage = substr($0, at)
      output = number(usage, "output_tokens")
      tokens[hour] += number(usage, "input_tokens") + number(usage, "cache_creation_input_tokens") + number(usage, "cache_read_input_tokens") + output
      written[hour] += output
    }
    END { for (hour in entries) print hour, entries[hour], tokens[hour] + 0, written[hour] + 0 }' "$transcript" | sort)
  printf '%s\n%s\n' "$key" "$counted" > "$cache/$name" 2>/dev/null
  printf '%s\n' "$counted"
}

while read -r host; do
  case $host in local_*) ;; *) continue ;; esac
  for record_file in "$records"/*/*/"$host.json"; do
    [ -f "$record_file" ] || continue
    clis=$(grep -o -e '"cliSessionId":"[^"]*"' -e '"lastAssistantCliSessionId":"[^"]*"' "$record_file" | cut -d '"' -f 4 | sort -u)
    [ "$mode" = status ] && clis=
    for cli in $clis; do
      for transcript in "$projects"/*/"$cli".jsonl; do
        [ -f "$transcript" ] && hours_of "$transcript"
      done
    done | awk -v host="$host" -v since="$since" '
      $1 >= since && $2 > 0 { entries[$1] += $2; tokens[$1] += $3; written[$1] += $4 }
      END {
        line = ""
        for (hour in entries) line = line " " hour "=" entries[hour] "," tokens[hour] "," written[hour]
        if (line != "") print "hours " host line
      }'
    # A summary written for an earlier reply is stale: the session has spoken since.
    summarized=$(grep -o '"postTurnSummaryFor":"[^"]*"' "$record_file" | cut -d '"' -f 4)
    last=$(grep -o '"lastAssistantUuid":"[^"]*"' "$record_file" | cut -d '"' -f 4)
    [ -n "$summarized" ] && [ "$summarized" = "$last" ] || continue
    sed -nE 's/.*"postTurnSummary":\{"status_category":"([a-z_]+)"(,"status_detail":"([^"\\]|\\.)*")?,"needs_action":"(([^"\\]|\\.)*)".*/\1 \4/p' "$record_file" |
      awk -v host="$host" '$1 != "completed" { print "status " host " " $0 }'
  done
done
exit 0
