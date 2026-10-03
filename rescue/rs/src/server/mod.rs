//! Port of rescue/Sources/rescue-server (main.swift split by its MARK blocks, Store.swift = store.rs).
//! Every call into crate::kit / crate::studio goes through adapt.rs.
mod adapt;
mod bake;
mod common;
mod exercise;
mod fixes;
mod http;
mod incidents;
mod inventory;
mod live;
mod state;
mod store;

/// `rescue-server [port] [--host H] [--pin NNNN]` (ServerGuard parses std::env::args);
/// `rescue-server --bake <file>` writes the build-time cache (bake.rs) and exits
pub fn main() {
    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("tokio runtime");
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--bake") {
        let Some(path) = args.get(i + 1) else {
            eprintln!("usage: rescue-server --bake <file>");
            std::process::exit(2);
        };
        if let Err(e) = rt.block_on(bake::bake(path)) {
            eprintln!("bake: {e}");
            std::process::exit(1);
        }
        return;
    }
    rt.block_on(http::run());
}
