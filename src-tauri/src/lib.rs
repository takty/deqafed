use std::{fs, path::{Path, PathBuf}, process::Command};

#[derive(serde::Serialize)]
struct OpenedFile {
    path: String,
    text: String,
}

#[tauri::command]
fn open_file() -> Result<Option<OpenedFile>, String> {
    let Some(path) = rfd::FileDialog::new().add_filter("Java files", &["java"]).add_filter("All files", &["*"]).pick_file() else {
        return Ok(None);
    };
    let text = fs::read_to_string(&path).map_err(|e| format!("Failed to read the file: {e}"))?;
    Ok(Some(OpenedFile { path: path.to_string_lossy().into_owned(), text }))
}

#[tauri::command]
fn save_file(path: Option<String>, name: String, text: String, other_paths: Vec<String>) -> Result<Option<String>, String> {
    let target = match path {
        Some(path) => PathBuf::from(path),
        None => match rfd::FileDialog::new().add_filter("Java files", &["java"]).set_file_name(&name).save_file() {
            Some(path) => path,
            None => return Ok(None),
        },
    };
    let target_key = target.to_string_lossy().replace('/', "\\").to_lowercase();
    if other_paths.iter().any(|p| p.replace('/', "\\").to_lowercase() == target_key) {
        return Err("That file is already open in another tab.".to_string());
    }
    fs::write(&target, text).map_err(|e| format!("Failed to save the file: {e}"))?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

#[tauri::command]
fn confirm_save(name: String) -> String {
    use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
    match MessageDialog::new().set_level(MessageLevel::Warning).set_title("Save Changes")
        .set_description(format!("Do you want to save changes to \"{name}\"?"))
        .set_buttons(MessageButtons::YesNoCancel).show() {
        MessageDialogResult::Yes => "save",
        MessageDialogResult::No => "discard",
        _ => "cancel",
    }.to_string()
}

#[tauri::command]
fn open_terminal(path: String) -> Result<(), String> {
    let directory = Path::new(&path).parent().ok_or("Could not determine the file's directory")?;
    #[cfg(target_os = "windows")]
    Command::new("cmd.exe").arg("/K").current_dir(directory).spawn().map_err(|e| format!("Failed to open the terminal: {e}"))?;
    #[cfg(not(target_os = "windows"))]
    return Err("This feature is available on Windows".to_string());
    #[cfg(target_os = "windows")]
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_file, save_file, confirm_save, open_terminal])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
