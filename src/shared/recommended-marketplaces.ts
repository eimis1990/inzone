/**
 * Curated list of plugin marketplaces INZONE recommends to users.
 *
 * A marketplace is a git repo whose root contains a
 * `.claude-plugin/marketplace.json` file listing the plugins it
 * publishes. Adding a marketplace lets the user browse + install
 * its plugins from the Settings → Plugins drawer.
 *
 * Each entry below shows up as a card in the right-side rail.
 * Clicking the card adds the marketplace to the user's
 * `~/.claude/plugins/marketplaces.json` and opens its catalog.
 *
 * Keep this list intentionally short. Like the Recommended Skills
 * + MCPs lists, the point is to give a fresh user at least one
 * usable starting point — not to be an exhaustive directory.
 *
 * Adding a new entry — checklist:
 *   1. Confirm the marketplace repo has a real
 *      `.claude-plugin/marketplace.json` at root.
 *   2. Pick a stable kebab-case `id`.
 *   3. Verify the source URL resolves (clone test or open in
 *      browser).
 */

import type { RecommendedMarketplace } from './types';

export const RECOMMENDED_MARKETPLACES: RecommendedMarketplace[] = [
  {
    id: 'anthropic-official',
    name: 'Anthropic Plugins',
    emoji: '🤖',
    description:
      "Anthropic's official plugin marketplace — curated bundles published and maintained by the team that builds Claude. Highest-trust source; the right place to start.",
    source: 'https://github.com/anthropics/claude-code',
    author: 'Anthropic',
    tags: ['official', 'curated'],
  },
  {
    id: 'anthropic-examples',
    name: 'Example Plugins',
    emoji: '🧪',
    description:
      "Anthropic's example plugin repo — reference implementations that demonstrate every part of the plugin format. A great place to see what's possible before writing your own.",
    source: 'https://github.com/anthropics/claude-code-plugins',
    author: 'Anthropic',
    tags: ['examples', 'reference'],
  },
];
