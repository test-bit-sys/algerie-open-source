//! DZ-DiskTree Native Core — Blazing Fast Disk Analyzer in Pure Rust
//! -----------------------------------------------------------------
//! Part of the DZ Open Suite (المنظومة الجزائرية للبرمجيات الحرة).
//! Designed to replace WizTree / TreeSize with native speed and zero runtime bloat.

use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

const CLUSTER_SIZE: u64 = 4096; // 4 KB NTFS/ext4 standard cluster

#[derive(Debug, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: PathBuf,
    pub size: u64,
    pub allocated_size: u64,
    pub is_dir: bool,
    pub file_count: u64,
    pub dir_count: u64,
    pub children: Vec<FileEntry>,
}

impl FileEntry {
    pub fn new(name: String, path: PathBuf, is_dir: bool) -> Self {
        Self {
            name,
            path,
            size: 0,
            allocated_size: 0,
            is_dir,
            file_count: 0,
            dir_count: 0,
            children: Vec::new(),
        }
    }
}

pub fn round_to_cluster(bytes: u64) -> u64 {
    if bytes == 0 {
        0
    } else {
        ((bytes + CLUSTER_SIZE - 1) / CLUSTER_SIZE) * CLUSTER_SIZE
    }
}

pub fn format_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    const TB: f64 = GB * 1024.0;

    let b = bytes as f64;
    if b >= TB {
        format!("{:.2} TB", b / TB)
    } else if b >= GB {
        format!("{:.2} GB", b / GB)
    } else if b >= MB {
        format!("{:.2} MB", b / MB)
    } else if b >= KB {
        format!("{:.2} KB", b / KB)
    } else {
        format!("{} B", bytes)
    }
}

pub fn scan_directory(path: &Path, max_depth: usize, current_depth: usize) -> FileEntry {
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());

    let mut entry = FileEntry::new(name, path.to_path_buf(), true);

    let read_dir = match fs::read_dir(path) {
        Ok(rd) => rd,
        Err(_) => return entry, // Permission denied or inaccessible
    };

    for item in read_dir.flatten() {
        let child_path = item.path();
        let metadata = match item.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let child_name = child_path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();

        if metadata.is_dir() {
            entry.dir_count += 1;
            if current_depth < max_depth {
                let sub_entry = scan_directory(&child_path, max_depth, current_depth + 1);
                entry.size += sub_entry.size;
                entry.allocated_size += sub_entry.allocated_size;
                entry.file_count += sub_entry.file_count;
                entry.dir_count += sub_entry.dir_count;
                entry.children.push(sub_entry);
            } else {
                // Approximate unexpanded directories
                entry.dir_count += 1;
            }
        } else if metadata.is_file() {
            let file_size = metadata.len();
            let allocated = round_to_cluster(file_size);
            entry.size += file_size;
            entry.allocated_size += allocated;
            entry.file_count += 1;

            if current_depth < max_depth {
                let mut f = FileEntry::new(child_name, child_path, false);
                f.size = file_size;
                f.allocated_size = allocated;
                entry.children.push(f);
            }
        }
    }

    // Sort children by size descending (largest first)
    entry.children.sort_by(|a, b| b.size.cmp(&a.size));

    entry
}

pub fn collect_largest_files(entry: &FileEntry, list: &mut Vec<(PathBuf, u64)>) {
    if !entry.is_dir {
        list.push((entry.path.clone(), entry.size));
    } else {
        for child in &entry.children {
            collect_largest_files(child, list);
        }
    }
}

pub fn print_tree(entry: &FileEntry, prefix: &str, is_last: bool, current_level: usize, max_levels: usize) {
    if current_level > max_levels {
        return;
    }

    let branch = if current_level == 0 {
        ""
    } else if is_last {
        "\\-- "
    } else {
        "+-- "
    };

    let type_marker = if entry.is_dir { "[DIR]" } else { "     " };
    println!(
        "{}{}{} {:<35} ({:>10}) [Alloc: {:>10}]",
        prefix,
        branch,
        type_marker,
        entry.name,
        format_bytes(entry.size),
        format_bytes(entry.allocated_size)
    );

    let new_prefix = if current_level == 0 {
        ""
    } else if is_last {
        &format!("{}    ", prefix)
    } else {
        &format!("{}|   ", prefix)
    };

    let total_children = entry.children.len();
    for (i, child) in entry.children.iter().enumerate() {
        print_tree(child, new_prefix, i == total_children - 1, current_level + 1, max_levels);
    }
}

pub fn export_json(entry: &FileEntry, writer: &mut impl Write) -> io::Result<()> {
    write!(
        writer,
        r#"{{"name":"{}","size":{},"allocated":{},"isDir":{},"files":{},"dirs":{},"children":["#,
        entry.name.replace('\\', "\\\\").replace('"', "\\\""),
        entry.size,
        entry.allocated_size,
        entry.is_dir,
        entry.file_count,
        entry.dir_count
    )?;

    for (i, child) in entry.children.iter().enumerate() {
        if i > 0 {
            write!(writer, ",")?;
        }
        export_json(child, writer)?;
    }

    write!(writer, "]}}")
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let mut target_dir = PathBuf::from(".");
    let mut json_mode = false;
    let mut max_depth = 4;
    let mut top_n = 10;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--json" => json_mode = true,
            "--depth" => {
                if i + 1 < args.len() {
                    max_depth = args[i + 1].parse().unwrap_or(4);
                    i += 1;
                }
            }
            "--top" => {
                if i + 1 < args.len() {
                    top_n = args[i + 1].parse().unwrap_or(10);
                    i += 1;
                }
            }
            "--help" | "-h" => {
                println!("DZ-DiskTree Native (المنظومة الجزائرية للبرمجيات الحرة)");
                println!("Usage: dz_disk_tree_native [OPTIONS] [PATH]");
                println!();
                println!("Options:");
                println!("  --json         Output tree directly in JSON format");
                println!("  --depth <N>    Maximum scan recursion depth (default: 4)");
                println!("  --top <N>      Display top N largest files (default: 10)");
                println!("  -h, --help     Print help information");
                return;
            }
            other => {
                if !other.starts_with("--") {
                    target_dir = PathBuf::from(other);
                }
            }
        }
        i += 1;
    }

    if !json_mode {
        println!("===============================================================================");
        println!("  DZ-DiskTree Native -- فاحص مساحات الأقراص فائق السرعة بلغة Rust (بديل WizTree)");
        println!("  المنظومة الجزائرية للبرمجيات المفتوحة المصدر (DZ Open Suite)");
        println!("===============================================================================");
        println!("Target Path : {}", target_dir.display());
        println!("Max Depth   : {}", max_depth);
        println!("Scanning...");
    }

    let start_time = Instant::now();
    let root = scan_directory(&target_dir, max_depth, 0);
    let elapsed = start_time.elapsed();

    if json_mode {
        let stdout = io::stdout();
        let mut handle = stdout.lock();
        let _ = export_json(&root, &mut handle);
        let _ = writeln!(handle);
        return;
    }

    println!();
    print_tree(&root, "", true, 0, max_depth);
    println!();
    println!("-------------------------------------------------------------------------------");
    println!(
        "Scan Summary: Total Files: {} | Total Directories: {} | Total Size: {} (Allocated: {})",
        root.file_count,
        root.dir_count,
        format_bytes(root.size),
        format_bytes(root.allocated_size)
    );
    println!("Elapsed Time: {:.2?} (Native Rust Engine)", elapsed);
    println!("-------------------------------------------------------------------------------");

    let mut largest = Vec::new();
    collect_largest_files(&root, &mut largest);
    largest.sort_by(|a, b| b.1.cmp(&a.1));

    if !largest.is_empty() {
        println!();
        println!("Top {} Largest Files in Selection:", top_n.min(largest.len()));
        for (idx, (p, sz)) in largest.iter().take(top_n).enumerate() {
            println!(
                "  {:>2}. {:<60} {:>12}",
                idx + 1,
                p.display().to_string(),
                format_bytes(*sz)
            );
        }
    }
    println!("===============================================================================");
}
