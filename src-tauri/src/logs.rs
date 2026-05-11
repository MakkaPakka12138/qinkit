use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
};

pub(crate) fn read_log_tail(path: &str, max_lines: usize) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok("日志路径为空。".to_string());
    }

    let keep = max_lines.max(20);
    let mut file = File::open(trimmed).map_err(|err| format!("读取日志失败 {trimmed}: {err}"))?;
    let mut position = file
        .seek(SeekFrom::End(0))
        .map_err(|err| format!("读取日志失败 {trimmed}: {err}"))?;

    let mut buffer = Vec::new();
    let mut newline_count = 0usize;
    const CHUNK_SIZE: usize = 8192;

    while position > 0 && newline_count <= keep {
        let read_size = position.min(CHUNK_SIZE as u64) as usize;
        position -= read_size as u64;

        file.seek(SeekFrom::Start(position))
            .map_err(|err| format!("读取日志失败 {trimmed}: {err}"))?;

        let mut chunk = vec![0; read_size];
        file.read_exact(&mut chunk)
            .map_err(|err| format!("读取日志失败 {trimmed}: {err}"))?;

        newline_count += chunk.iter().filter(|&&byte| byte == b'\n').count();
        chunk.extend_from_slice(&buffer);
        buffer = chunk;
    }

    let text = String::from_utf8_lossy(&buffer);
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(keep);
    Ok(lines[start..].join("\n"))
}
