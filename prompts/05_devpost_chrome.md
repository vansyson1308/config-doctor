# Prompt 05 — Fill the Devpost submission (for Claude in Chrome)

Goal: create and fully fill the Codegeist 2026 Devpost submission for **Config Doctor for Jira**, save it as a
draft, and STOP before the final submit so the owner can review. All texts come from the public repo — copy
them exactly, do not invent claims.

Sources (open in tabs and read first):
- https://github.com/vansyson1308/config-doctor/blob/main/docs/SUBMISSION.md (§1 install link + §1.3 judge
  quick start, §2 write-up, §4 checklist)
- https://github.com/vansyson1308/config-doctor (README)
- Hackathon: https://codegeist2026.devpost.com/ (Rules and the submission form's required fields)
Owner will give you: the **YouTube URL** of the demo video (public). If you don't have it, ask before starting.

Local files to upload (on this PC):
- Thumbnail: C:\Users\MSI\projects\config-doctor\docs\brand\devpost-thumbnail-1200x800.png
- Gallery: C:\Users\MSI\projects\config-doctor\docs\marketplace\*.png (or docs\screenshots\*.png if that folder
  does not exist yet), in order: overview, access explainer, impact, audit log, Rovo chat.

Steps:
1. On codegeist2026.devpost.com click "Enter a submission" / "My projects" and open (or create) the project
   draft "Config Doctor for Jira". The owner is already logged in; if not, stop and ask him to log in.
2. Fill every field:
   - Project name: Config Doctor for Jira
   - Elevator pitch / tagline: from §2 "Tagline" (trim to the field limit without changing meaning)
   - Thumbnail: the file above.
   - About the project (story): §2 sections Inspiration, What it does, How we built it, Challenges,
     Accomplishments, What we learned, What's next — as Markdown, headings preserved.
   - Built with: Atlassian Forge, Rovo, Rovo MCP, Jira Cloud REST API, Forge UI Kit, Forge KVS, TypeScript,
     Node.js, Vitest (add as tags).
   - "Try it out" links: the GitHub repo URL and the installation link from §1 (raw link).
   - Video demo link: the YouTube URL.
   - Image gallery: the screenshots above with short captions.
   - Additional / hackathon-specific questions: Category = **Apps for Software Teams**; Bonus prizes = **Best
     Agents** and **Best app with Atlassian MCP** (do not tick Marketplace unless the owner gives a listing or
     review-ticket link; do not tick Teamwork Graph); Installation link = §1 raw link; Testing instructions =
     §1.3 verbatim; Technical requirement explanation = §2 "Technical requirement explanation"; any field
     asking for Marketplace link → leave empty unless provided.
   - Team: solo (owner). Do not invite anyone.
3. Save as draft. Then review the public preview page: video embeds and plays, thumbnail and gallery show,
   links open (install link opens the Atlassian install page; repo opens), Markdown renders.
4. If the form requires accepting rules/terms or a final "Submit" click: STOP, list what you filled, show any
   field you could not fill, and ask the owner: "Ready to submit Config Doctor for Jira to Codegeist 2026?" Only
   submit after an explicit "yes" from the owner in this chat.
5. After submitting, confirm the project page shows it as submitted to Codegeist 2026 and report the URL.
