use super::types::FbxAnimationStackDto;
use regex::Regex;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

const ACTION_NAME_MAPPING_FILE: &str = "action_name_mapping.txt";

struct ActionNameRule {
    matcher: Regex,
    target: String,
}

pub(super) struct ActionNameMapping {
    rules: Vec<ActionNameRule>,
}

impl ActionNameMapping {
    fn from_text(text: &str) -> Option<Self> {
        let rules: Vec<ActionNameRule> = text
            .lines()
            .filter_map(parse_rule_line)
            .filter_map(|(pattern, target)| {
                Regex::new(pattern).ok().map(|matcher| ActionNameRule {
                    matcher,
                    target: target.to_string(),
                })
            })
            .collect();

        if rules.is_empty() {
            None
        } else {
            Some(Self { rules })
        }
    }

    fn from_file(path: &Path) -> std::io::Result<Option<Self>> {
        fs::read_to_string(path).map(|text| Self::from_text(&text))
    }

    fn map_name(&self, raw_name: &str) -> Option<String> {
        self.rules
            .iter()
            .find(|rule| rule.matcher.is_match(raw_name))
            .map(|rule| rule.target.clone())
    }

    fn map_sequence_names(&self, raw_names: &[String]) -> Vec<Option<String>> {
        let mapped_bases: Vec<Option<String>> =
            raw_names.iter().map(|name| self.map_name(name)).collect();
        let mut base_counts: HashMap<&str, usize> = HashMap::new();
        for base in mapped_bases.iter().flatten() {
            *base_counts.entry(base.as_str()).or_insert(0) += 1;
        }

        let mut seen_counts: HashMap<&str, usize> = HashMap::new();
        mapped_bases
            .iter()
            .map(|mapped_base| {
                let base = mapped_base.as_ref()?;
                if base_counts.get(base.as_str()).copied().unwrap_or(0) <= 1 {
                    return Some(base.clone());
                }

                let seen = seen_counts.entry(base.as_str()).or_insert(0);
                *seen += 1;
                Some(format!("{base}{seen}"))
            })
            .collect()
    }

    pub(super) fn apply_to_animation_stacks(&self, stacks: &mut [FbxAnimationStackDto]) {
        let raw_names: Vec<String> = stacks.iter().map(|stack| stack.name.clone()).collect();
        for (stack, mapped_name) in stacks.iter_mut().zip(self.map_sequence_names(&raw_names)) {
            if let Some(name) = mapped_name {
                stack.name = name;
            }
        }
    }
}

fn parse_rule_line(line: &str) -> Option<(&str, &str)> {
    let trimmed = line.trim().trim_start_matches('\u{feff}').trim();
    if trimmed.is_empty() || trimmed.starts_with('[') {
        return None;
    }

    let (pattern, target) = trimmed.split_once("->")?;
    let pattern = pattern.trim();
    let target = target.trim();
    if pattern.is_empty() || target.is_empty() {
        None
    } else {
        Some((pattern, target))
    }
}

pub(super) fn load_action_name_mapping_from_exe_dir() -> Option<ActionNameMapping> {
    let exe_path = std::env::current_exe().ok()?;
    let mapping_path = exe_path.parent()?.join(ACTION_NAME_MAPPING_FILE);
    ActionNameMapping::from_file(&mapping_path).ok().flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_regex_rules_and_ignores_section_headers() {
        let mapping = ActionNameMapping::from_text(
            "[attack group]\n\
             .*attack.* -> attack\n\
             [stand group]\n\
             .*idle.* -> stand\n",
        )
        .expect("valid mapping rules should parse");

        let names = vec!["hero_attack_a".to_string(), "idle_loop".to_string()];
        assert_eq!(
            mapping.map_sequence_names(&names),
            vec![Some("attack".to_string()), Some("stand".to_string())]
        );
    }

    #[test]
    fn adds_number_suffixes_when_multiple_stacks_map_to_same_action() {
        let mapping = ActionNameMapping::from_text(".*attack.* -> attack\n.*atk.* -> attack\n")
            .expect("valid mapping rules should parse");
        let names = vec![
            "attack_a".to_string(),
            "run".to_string(),
            "atk_b".to_string(),
        ];

        assert_eq!(
            mapping.map_sequence_names(&names),
            vec![
                Some("attack1".to_string()),
                None,
                Some("attack2".to_string())
            ]
        );
    }

    #[test]
    fn invalid_regex_rules_do_not_block_valid_rules() {
        let mapping = ActionNameMapping::from_text("[ -> broken\n.*run.* -> walk\n")
            .expect("valid mapping rules should survive invalid regex rules");

        let names = vec!["fast_run".to_string(), "idle".to_string()];
        assert_eq!(
            mapping.map_sequence_names(&names),
            vec![Some("walk".to_string()), None]
        );
    }
}
