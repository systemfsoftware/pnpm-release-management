import type { UserConfig } from '@commitlint/types'

/**
 * systemfsoftware low-friction commitlint config.
 *
 * A rule is `error` (2) ONLY if a wrong value has real downstream impact in
 * this org. Releases run on changesets (.changeset/*.md), NOT commit messages,
 * so scope / punctuation / type-vs-diff have ZERO release impact and must never
 * fail a commit. The one message policy that matters is the AI-coauthor ban.
 */

const configuration: UserConfig = {
  extends: ['@commitlint/config-conventional'],

  plugins: [
    {
      rules: {
        'no-ai-coauthors': ({ raw }) => {
          if (raw == null || raw === '') {
            return [true, 'OK']
          }

          // AI co-author email patterns
          const aiEmailPatterns = [
            /noreply@anthropic\.com/i,
            /cursoragent@cursor\.com/i,
            /noreply@aider\.dev/i,
            /cascade@windsurf\.com/i,
            /noreply@codeium\.com/i,
            /clio-agent@sisyphuslabs\.ai/i,
            /factory-droid\[bot\]@users\.noreply\.github\.com/i,
          ] as const

          // Only scan Co-authored-by lines for AI model mentions to avoid false positives
          // (e.g., "Opus" audio codec, "Haiku" build tool)
          const coauthorLines = raw.match(/^Co-?-?[Aa]uthored-by:.*$/gmi) || []
          const aiModelPatterns = [
            /\b(Claude\s+)?(Opus|Sonnet|Haiku)\b/i,
            /\bgpt-4o\b/i,
            /\bClaude\b.*\b3\.\d+\b/i,
          ] as const
          const hasAIModelInCoauthor = coauthorLines.some((line: string) =>
            aiModelPatterns.some((pattern) => pattern.test(line))
          )

          const hasAIEmail = aiEmailPatterns.some((pattern) => pattern.test(raw))
          const hasAICoauthor = hasAIEmail || hasAIModelInCoauthor

          const message = 'AI co-authors and AI model references are not allowed in commit messages'
          if (hasAICoauthor) return [false, message]
          return [true, 'OK']
        },
      },
    },
  ],

  rules: {
    // AI co-author prevention — the one message policy that matters.
    'no-ai-coauthors': [2, 'always'],

    // Commit types — tidy log/PR grouping only (releases run on changesets).
    'type-enum': [
      2,
      'always',
      [
        'ai',
        'api',
        'build',
        'chore',
        'ci',
        'deps',
        'docs',
        'e2e',
        'feat',
        'fix',
        'improvement',
        'perf',
        'refactor',
        'revert',
        'security',
        'style',
        'test',
      ],
    ],

    // Type constraints
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],

    // Subject — must exist; everything else about it is cosmetic.
    'subject-case': [0],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [0],

    // Scope — zero release impact and agents can't guess an enum. OFF; nudge casing.
    'scope-enum': [0],
    'scope-case': [1, 'always', 'kebab-case'],

    // Punctuation — zero impact. OFF.
    'header-full-stop': [0],
    'body-full-stop': [0],

    // Length — burns retry tokens, no impact. OFF.
    'header-max-length': [0],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],

    // Readability nudges — warn, never block.
    'body-leading-blank': [1, 'always'],
    'footer-leading-blank': [1, 'always'],

    // References encouraged but not required (warning, non-blocking)
    'references-empty': [1, 'never'],
  },

  defaultIgnores: true,
  formatter: '@commitlint/format',
}

export default configuration
