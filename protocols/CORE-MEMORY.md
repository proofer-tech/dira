# Memory file format - core

Referenced from `CORE.md` §Retrospective (회고). Files are in
`personas/<name>/memory/`, one concept per file. Not inlined into prompts - dispatch
prompts carry only the directory's location and how to grep it; sessions open files
on demand, and `[[links]]` are followed one hop with
`grep -rl '\[\[<name>\]\]' <memory dir>`.

No frontmatter. The first line doubles as the on-screen excerpt. Example
(memory itself is a human-editable layer, so entries stay in the queue's language):

```markdown
# 워크트리 push 경합

받는 트리가 더러워서 push가 거부되면 셋 중 하나다. 앞의 둘은 `## 블록`이고
`diff --cached`가 비었는데 unstaged 전진 diff만 있으면 30초 뒤 한 번 더 본다.

관련: [[티켓 상태 전이.md]]
출처: `2434a5dc` `f14432b5`
```

- `관련:` - neighbor concept files (the `[[...]]` link targets).
- `출처:` - hashes of the tickets where this was learned. When a human meets a wrong
  lesson on screen, these hashes are how they trace where it came from and decide
  whether to delete it.

What belongs here: judgments and thresholds a session had to re-derive because no doc
records them. What does not: anything `docs/` or `AGENTS.md` already says (duplication
makes the next session grep-read the same thing twice), and per-ticket anecdotes -
fold the story, keep the ruling; a `출처:` hash can stand in for the episode.
