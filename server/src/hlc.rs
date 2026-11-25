//! Horloge logique hybride côté serveur (événements créés par webhook ou API).
use std::sync::Mutex;

pub const SERVER_DEVICE: &str = "server";

pub struct Hlc {
    state: Mutex<(i64, u32)>,
}

impl Hlc {
    pub fn new() -> Self {
        Self {
            state: Mutex::new((0, 0)),
        }
    }

    pub fn now(&self) -> String {
        let wall = chrono::Utc::now().timestamp_millis();
        let mut s = self.state.lock().unwrap();
        if wall > s.0 {
            *s = (wall, 0);
        } else {
            s.1 += 1;
            if s.1 > 9999 {
                s.0 += 1;
                s.1 = 0;
            }
        }
        format!("{:013}-{:04}-{}", s.0, s.1, SERVER_DEVICE)
    }

    pub fn receive(&self, remote: &str) {
        let mut parts = remote.splitn(3, '-');
        let (Some(ms), Some(c)) = (parts.next(), parts.next()) else {
            return;
        };
        let (Ok(ms), Ok(c)) = (ms.parse::<i64>(), c.parse::<u32>()) else {
            return;
        };
        let mut s = self.state.lock().unwrap();
        if (ms, c) > *s {
            *s = (ms, c);
        }
    }
}

impl Default for Hlc {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn monotone() {
        let h = Hlc::new();
        let a = h.now();
        h.receive("9999999999999-0005-x");
        let b = h.now();
        assert!(b > a);
        assert!(b.starts_with("9999999999999-0006"));
    }
}
