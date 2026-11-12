import { schemaRows, type JsonSchema } from './schema';
import { InlineText } from './widgets';

/** A schema as a table of properties, nested properties indented. */
export function SchemaTable({
  schema,
  caption,
}: {
  schema: JsonSchema | undefined;
  caption: string;
}) {
  const rows = schemaRows(schema);
  if (rows.length === 0) return <p className="dev-muted">No fields.</p>;
  return (
    <div className="dev-table" tabIndex={0} role="region" aria-label={caption}>
      <table>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Type</th>
            <th scope="col">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.path}>
              <td>
                <code style={{ paddingLeft: `${row.depth * 14}px` }}>{row.name}</code>
                {row.required ? <span className="dev-req"> required</span> : null}
              </td>
              <td>
                <code>{row.type}</code>
              </td>
              <td>
                {row.description ? <InlineText text={row.description} /> : null}
                {row.details.length > 0 ? (
                  <div className="dev-muted">{row.details.join(' · ')}</div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
