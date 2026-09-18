import { CopyButton } from './CopyButton';

interface JsonViewProps {
  value: unknown;
}

/** Collapsed technical view of the raw API response — off the main flow. */
export function JsonView({ value }: JsonViewProps) {
  const text = JSON.stringify(value, null, 2);
  return (
    <details className="raw">
      <summary>Raw response</summary>
      <div className="raw__body">
        <CopyButton text={text} label="Copy JSON" />
        <pre>
          <code>{text}</code>
        </pre>
      </div>
    </details>
  );
}
