fn main() {
    // tauri-build watches tauri.conf.json, but not the icon files that config
    // points at, so a regenerated icon set is otherwise baked into the binary
    // only on the next unrelated Rust rebuild: `tauri dev` happily relaunches a
    // stale binary carrying the previous dock icon.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
