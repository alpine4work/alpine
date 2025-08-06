# 🧪 Experimental Directory 🧪

Welcome to your personal playground! This directory is where developers can experiment, prototype, and explore new ideas without the constraints of production code review.

### 📁 Structure

Each developer gets their own dedicated folder in this directory:

```
experimental/
├── ifitzsimmons/     # Ian's experiments
├── calebmer/         # Caleb's experiments
└── [your-name]/      # Add your folder here
```

### 🎯 Purpose

This is your **personal sandbox** for:
- 🛠️ **Tools & utilities** you're building
- 🎨 **Demos & prototypes**
- 🔬 **Proof-of-concepts**
- 📚 **Learning experiments**
- 🎪 **Whatever else you want to give a permanent home**

### Experimental Scripts
Want to create scripts that integrate with the `dev experimental` command? Here's how to set up your own experimental tools:

#### 📋 Setup Process

1. **Create your script** in your personal folder (e.g., `experimental/ifitzsimmons/`)
2. **Bundle with Bazel** using the appropriate build rules
3. **Register your command** by adding it to `~/admin/experimental/experimental_commands.bzl`

#### 📝 Example Implementation

Here's how `generate-build-file` was implemented:

**BUILD file** (`admin/experimental/ifitzsimmons/BUILD`):
```python
load("//admin/typescript:typescript.bzl", "ts_project")
load("@aspect_rules_js//js:defs.bzl", "js_binary")

ts_project(
    name = "generate_build_file_lib",
    visibility = ["//admin:__subpackages__"],
    deps = ["//:node_modules/@types/node"],
)

js_binary(
    name = "generate_build_file",
    entry_point = "generate_build_file.js",
    data = [":generate_build_file_lib"],
    visibility = ["//visibility:public"],
)
```

**Registration** (`admin/experimental/experimental_commands.bzl`):
```python
EXPERIMENTAL_COMMANDS = {
    "generate-build-file": {
        "target": "//admin/experimental/ifitzsimmons:generate_build_file",
        "description": "Automates BUILD file dependency management based on imports",
    },
}
```

#### 🚀 Usage

Once registered, your script becomes available via:
```bash
dev experimental your-script-name
```

### ⚠️ Important Notes

- **No code review**: We do zero code review for anything committed to your personal folder
- **No production deployment**: Code in this directory should never reach production
- **Personal responsibility**: Keep your experiments organized and documented
- **Team awareness**: Let others know if you're working on something that might be useful to the team

---

*Happy experimenting! 🎉*
