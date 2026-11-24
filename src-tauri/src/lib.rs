use std::{fs, path::{Path, PathBuf}};

#[derive(serde::Serialize)]
struct OpenedFile {
    path: String,
    text: String,
}

#[derive(serde::Serialize)]
#[serde(tag = "key", content = "detail", rename_all = "camelCase")]
enum CommandError {
    ReadFile(String),
    SaveFile(String),
    FileAlreadyOpen,
    #[cfg(target_os = "windows")]
    FileDirectory,
    #[cfg(target_os = "windows")]
    OpenTerminal(String),
    #[cfg(not(target_os = "windows"))]
    TerminalUnavailable,
}

#[tauri::command]
fn open_file(java_files: String, all_files: String) -> Result<Option<OpenedFile>, CommandError> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter(java_files, &["java"])
        .add_filter(all_files, &["*"])
        .pick_file()
    else {
        return Ok(None);
    };
    read_opened_file(&path).map(Some)
}

#[tauri::command]
async fn read_dropped_file(path: PathBuf) -> Result<OpenedFile, CommandError> {
    read_opened_file(&path)
}

fn read_opened_file(path: &Path) -> Result<OpenedFile, CommandError> {
    let text = fs::read_to_string(path).map_err(|error| CommandError::ReadFile(error.to_string()))?;
    Ok(OpenedFile { path: path.to_string_lossy().into_owned(), text })
}

#[tauri::command]
fn save_file(
    path: Option<String>,
    name: String,
    text: String,
    other_paths: Vec<String>,
    java_files: String,
) -> Result<Option<String>, CommandError> {
    let target = match path {
        Some(path) => PathBuf::from(path),
        None => match rfd::FileDialog::new().add_filter(java_files, &["java"]).set_file_name(&name).save_file() {
            Some(path) => path,
            None => return Ok(None),
        },
    };
    let target_key = target.to_string_lossy().replace('/', "\\").to_lowercase();
    if other_paths.iter().any(|p| p.replace('/', "\\").to_lowercase() == target_key) {
        return Err(CommandError::FileAlreadyOpen);
    }
    fs::write(&target, text).map_err(|error| CommandError::SaveFile(error.to_string()))?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

#[tauri::command]
fn confirm_save(title: String, description: String, save: String, discard: String, cancel: String) -> &'static str {
    use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
    match MessageDialog::new()
        .set_level(MessageLevel::Warning)
        .set_title(title)
        .set_description(description)
        .set_buttons(MessageButtons::YesNoCancelCustom(save.clone(), discard.clone(), cancel))
        .show()
    {
        MessageDialogResult::Yes => "save",
        MessageDialogResult::No => "discard",
        MessageDialogResult::Custom(label) if label == save => "save",
        MessageDialogResult::Custom(label) if label == discard => "discard",
        _ => "cancel",
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn open_terminal(path: String) -> Result<(), CommandError> {
    let directory = Path::new(&path).parent().ok_or(CommandError::FileDirectory)?;
    std::process::Command::new("cmd.exe")
        .arg("/K")
        .current_dir(directory)
        .spawn()
        .map_err(|error| CommandError::OpenTerminal(error.to_string()))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn open_terminal(path: String) -> Result<(), CommandError> {
    let _ = path;
    Err(CommandError::TerminalUnavailable)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_file, read_dropped_file, save_file, confirm_save, open_terminal])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
