# Exact Solid 2.0 port

This tree is reserved for the source-aligned LilScript port of the browser
runtime pinned in `upstream.lock.json`.

Every upstream runtime file must have a matching relative path with only its
extension changed to `.lil`. A file is not marked verified until its upstream
behavior tests pass against both implementations. Forwarding files and export
name checks do not count.

The existing files directly under `src/` are the earlier compatibility
prototype. They remain buildable while this port is completed, but they are not
evidence of exact Solid behavior.
