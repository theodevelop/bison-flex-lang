# Docusaurus Docs Guidance

- Keep product docs under `website/docs/`.
- Use short front matter: `title`, `description`, and optionally `sidebar_position`.
- Keep one topic per page and link to adjacent pages instead of duplicating content.
- Add new pages to `website/sidebars.ts` so navigation stays predictable.
- Use Docusaurus admonitions for status:
  - `:::tip Stable` for current extension features.
  - `:::info Planned for V2` for roadmap features.
  - `:::caution Preview` for design directions that may change.
- Prefer relative Markdown links to internal docs.
- Use fenced code blocks with a language tag.
- Validate with `npm run build` from `website/` before finishing.
