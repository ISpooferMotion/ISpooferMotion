pub mod api_dump;
pub mod commands;
pub mod error;
pub mod studio_bridge;
pub mod utils;

use tauri::{Emitter, Listener, Manager};

// This giant macro handles tossing all our backend commands over to the frontend.
// Gotta make sure any new command gets added here otherwise the UI won't be able to invoke it.
macro_rules! specta_commands {
    () => {
        tauri_specta::collect_commands![
            crate::commands::assets::fetch_assets,
            crate::commands::assets::fetch_roblox_thumbnail,
            crate::commands::assets::fetch_animation_xml,
            crate::commands::auth::get_cookie_from_roblox_studio,
            crate::commands::auth::get_cookie_from_auto_detect,
            crate::commands::auth::delete_saved_roblox_profile_cookie,
            crate::commands::auth::get_csrf_token,
            crate::commands::auth::get_authenticated_user_id,
            crate::commands::auth::get_roblox_user_info,
            crate::commands::auth::get_roblox_user_avatar,
            crate::commands::auth::get_manageable_groups,
            crate::commands::auth::get_group_icon,
            crate::commands::auth::get_group_icons_batch,
            crate::commands::auth::detect_opencloud_api_key_owner,
            crate::commands::auth::validate_opencloud_api_key,
            crate::commands::auth::get_auth_metadata,
            crate::commands::discord::clear_discord_report_auth,
            crate::commands::discord::load_discord_report_auth,
            crate::commands::discord::save_discord_report_auth,
            crate::commands::discord::discord_reporting_configured,
            crate::commands::discord::start_discord_login,
            crate::commands::discord::open_discord_deep_link,
            crate::commands::discord::verify_discord_auth,
            crate::commands::discord::poll_discord_login,
            crate::commands::discord::fetch_discord_announcements,
            crate::commands::discord::fetch_discord_poll,
            crate::commands::discord::submit_discord_poll_vote,
            crate::commands::discord::open_discord_poll,
            crate::commands::discord::close_discord_poll,
            crate::commands::fs::open_data_folder,
            crate::commands::fs::open_themes_folder,
            crate::commands::fs::clear_app_cache,
            crate::commands::fs::play_roblox_audio,
            crate::commands::fs::show_notification,
            crate::commands::fs::open_dev_console,
            crate::commands::ipc::app::window_minimize,
            crate::commands::ipc::app::window_close,
            crate::commands::ipc::app::quit_app,
            crate::commands::ipc::app::get_app_version,
            crate::commands::ipc::app::get_release_source,
            crate::commands::ipc::app::get_runtime_info,
            crate::commands::ipc::app::open_external,
            crate::commands::ipc::app::select_folder,
            crate::commands::ipc::app::uninstall_app,
            crate::commands::ipc::app::clear_plugin_cache,
            crate::commands::ipc::app::open_frontend_devtools,
            crate::commands::ipc::job::run_spoofer_action,
            crate::commands::ipc::job::spoofer_pause,
            crate::commands::ipc::job::spoofer_resume,
            crate::commands::ipc::job::spoofer_cancel,
            crate::commands::ipc::job::check_session,
            crate::commands::ipc::logging::append_debug_log,
            crate::commands::ipc::logging::open_logs_folder,
            crate::commands::ipc::logging::open_plugins_folder,
            crate::commands::ipc::logging::copy_debug_info,
            crate::commands::ipc::logging::export_support_report,
            crate::commands::ipc::profile::get_roblox_profile,
            crate::commands::ipc::profile::fetch_audio_quota,
            crate::commands::ipc::secrets::load_renderer_settings,
            crate::commands::ipc::secrets::save_renderer_settings,
            crate::commands::ipc::secrets::load_profile_secrets,
            crate::commands::ipc::secrets::save_profile_secrets,
            crate::commands::ipc::secrets::clear_profile_secrets,
            crate::commands::jobs::get_jobs,
            crate::commands::jobs::delete_job,
            crate::commands::jobs::open_job_log,
            crate::commands::resolver::resolve_asset_creators,
            crate::commands::resolver::resolve_script_references,
            crate::commands::resolver::validate_asset_ids,
            crate::commands::roblox_status::check_roblox_api_status,
            crate::commands::session::save_session,
            crate::commands::session::load_session,
            crate::commands::session::clear_session,
            crate::commands::spoofer::memory::find_studio_process,
            crate::commands::spoofer::memory::focus_and_save_studio,
            crate::commands::spoofer::memory::scan_and_replace_multiple_strings,
            crate::commands::spoofer::clear_asset_cache,
            crate::commands::spoofer::permissions::patch_asset_permissions,
            crate::commands::spoofer::permissions::set_asset_privacy,
            crate::commands::spoofer::place::get_place_id_from_creator,
            crate::commands::spoofer::place::get_multiple_place_ids,
            crate::commands::spoofer::place::get_universe_id_from_place_id,
            crate::commands::spoofer::place::search_global_places,
            crate::commands::spoofer::place::clear_downloads_directory_command,
            crate::commands::spoofer::place::find_asset_by_name,
            crate::commands::studio::push_to_studio,
            crate::studio_bridge::get_plugin_api_key,
            crate::studio_bridge::trigger_key_pairing,
            crate::studio_bridge::confirm_key_pairing,
            crate::studio_bridge::set_bridge_skip_owned_check,
            crate::studio_bridge::get_pairing_status,
            crate::studio_bridge::get_plugin_bridge_port,
            crate::studio_bridge::get_studio_health_status,
            crate::studio_bridge::get_studio_asset_snapshots
        ]
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Export typescript bindings in debug mode so our frontend always has up-to-date types
    #[cfg(debug_assertions)]
    {
        println!("ISpooferMotion: Exporting Specta bindings in a high-stack thread...");
        std::thread::Builder::new()
            .stack_size(128 * 1024 * 1024)
            .name("specta-export".to_string())
            .spawn(|| {
                let builder =
                    tauri_specta::Builder::<tauri::Wry>::new().commands(specta_commands!());
                builder
                    .export(specta_typescript::Typescript::default(), "../src/bindings.ts")
                    .expect("Failed to export typescript bindings");
            })
            .expect("Failed to spawn specta thread")
            .join()
            .expect("Failed to join specta thread");
        println!("ISpooferMotion: Finished Exporting Specta bindings!");
    }

    println!("ISpooferMotion: Initializing Tauri Builder...");
    let builder = tauri_specta::Builder::<tauri::Wry>::new().commands(specta_commands!());

    tauri::Builder::default()
        .invoke_handler(builder.invoke_handler())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            // Deep link handling (mainly used for Discord OAuth returning back to the app)
            app.listen("deep-link://new-url", {
                let app_handle = app.handle().clone();
                move |event| {
                    if let Ok(urls) = serde_json::from_str::<Vec<String>>(event.payload()) {
                        for url in urls {
                            if let Some(token) = url.strip_prefix("ispoofermotion://auth?token=") {
                                let auth_payload = serde_json::json!({ "loginToken": token });
                                if let Err(e) = crate::commands::discord::save_discord_report_auth(
                                    crate::commands::discord::AnyValue(auth_payload.clone()),
                                ) {
                                    log::error!("Failed to save discord auth payload from deep link: {:?}", e);
                                }
                                // let the UI know we got it
                                let _ = app_handle.emit("discord-login-success", ());
                            } else if url.starts_with("ispoofermotion://theme/apply") {
                                let _ = app_handle.emit("cloud-theme-sync-now", ());
                            }
                        }
                    } else if let Some(payload_clean) = event.payload().trim_matches('"').into() {
                        let payload_clean: &str = payload_clean;
                        if let Some(token) =
                            payload_clean.strip_prefix("ispoofermotion://auth?token=")
                        {
                            let auth_payload = serde_json::json!({ "loginToken": token });
                            if let Err(e) = crate::commands::discord::save_discord_report_auth(
                                crate::commands::discord::AnyValue(auth_payload.clone()),
                            ) {
                                log::error!("Failed to save discord auth payload from deep link (fallback): {:?}", e);
                            }
                            let _ = app_handle.emit("discord-login-success", ());
                        } else if payload_clean.starts_with("ispoofermotion://theme/apply") {
                            let _ = app_handle.emit("cloud-theme-sync-now", ());
                        }
                    }
                }
            });

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build(),
                )?;
            }

            // Spin up the bridge server in the background
            tauri::async_runtime::spawn(crate::studio_bridge::start_server(app.handle().clone()));

            // Setup tray icon so people don't lose the app when they close the main window
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            let _tray = TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .expect("default window icon should be bundled for tray setup"),
                )
                .tooltip("ISpooferMotion")
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
    println!("ISpooferMotion: Exiting run()");
}
