use std::{
    fs::File,
    io::{BufRead, BufReader},
};

pub(crate) fn read_log_tail(path: &str, max_lines: usize) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok("日志路径为空。".to_string());
    }

    let keep = max_lines.max(20);
    let file = File::open(trimmed).map_err(|err| format!("读取日志失败 {trimmed}: {err}"))?;
    let reader = BufReader::new(file);
    let lines: Vec<String> = reader.lines().map_while(Result::ok).collect();
    let start = lines.len().saturating_sub(keep);
    Ok(lines[start..].join("\n"))
}
