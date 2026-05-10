import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { useRenderCount } from '../perf/useRenderCount';

interface MarkdownProps {
  text: string;
}

/**
 * Rich-text rendering for assistant messages and tool results.
 * Lists, tables, fenced code with syntax highlighting, links that open
 * in the user's default browser via the system's window-open handler.
 *
 * Memoised: react-markdown + remark-gfm + rehype-highlight is the
 * single most expensive thing rendered per chat message. Without
 * memo, every Pane re-render parses every prior message's markdown
 * from scratch — quadratic work in transcript length. Default
 * shallow compare on the one prop (`text: string`) is exactly what
 * we want; strings compare by value.
 */
function MarkdownImpl({ text }: MarkdownProps) {
  useRenderCount('Markdown');
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a({ href, children, ...rest }) {
            return (
              <a
                {...rest}
                href={href}
                target="_blank"
                rel="noreferrer noopener"
              >
                {children}
              </a>
            );
          },
          code({ className, children, ...rest }) {
            // Heuristic: react-markdown gives us no `inline` prop in v9,
            // but inline code lacks a hljs language- className.
            const isBlock =
              typeof className === 'string' &&
              /\blanguage-/.test(className);
            if (isBlock) {
              const langMatch = /language-([\w-]+)/.exec(className ?? '');
              const lang = langMatch?.[1] ?? 'text';
              return (
                <div className="md-code-block">
                  <div className="md-code-lang">{lang}</div>
                  <pre>
                    <code className={className} {...rest}>
                      {children}
                    </code>
                  </pre>
                </div>
              );
            }
            return (
              <code className="md-inline-code" {...rest}>
                {children}
              </code>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
