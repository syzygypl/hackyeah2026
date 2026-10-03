//! Port of rescue/Sources/rescue-server (main.swift split by its MARK blocks, Store.swift = store.rs).
//! Every call into crate::kit / crate::studio goes through adapt.rs.
pub mod adapt;
pub mod common;
pub mod exercise;
pub mod fixes;
pub mod http;
pub mod incidents;
pub mod inventory;
pub mod live;
pub mod state;
pub mod store;

/// `rescue-server [port] [--host H] [--pin NNNN]` (ServerGuard parses std::env::args)
pub fn main() {
    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("tokio runtime");
    rt.block_on(http::run());
}
