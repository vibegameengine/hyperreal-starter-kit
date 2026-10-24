# Runtime links on Windows

Portable kit decision: generated runtime paths must remain excluded from Git both as directories and as Windows junction entries. A clean checkout and a linked checkout must identify the same runtime sources.

On 2026-10-25, the clean-clone test at `fce7463` passed setup but the next doctor check failed with `fatal: Unable to hash Content/Characters/Mannequins`. Git listed generated junction paths despite existing ignore patterns ending in `/`. Explicit root-relative patterns without a trailing slash restore the intended boundary between runtime sources and generated links.
