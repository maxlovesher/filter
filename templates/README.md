# Featured templates

Every `.json` file in this folder is built into the site and shown to **every visitor**
under **Featured** in the template list.

## Add one

1. In the app, build the look and save it.
2. In the template list, open its **⋯** menu → **Export template file** (or **Export all**).
3. Put the downloaded `something.fiilter.json` in this folder.
4. Commit and push — the host rebuilds and the template is live.

A file can hold one template or many. LUTs used by a template are included in the file automatically.

Optional: add a short description by editing the file and adding `"note"` next to `"name"`:

```json
{ "name": "Foggy Night", "note": "Purple haze, lifted blacks", "settings": { … } }
```

To remove a template, delete its file (or its entry) and push again.
