import { For, Show, createMemo, createSignal } from "solid-js"
import { render } from "@solidjs/web"

function message(id, from, subject, body, unread) {
  const [isUnread, setUnread] = createSignal(unread)
  return { id, from, subject, body, unread: isUnread, setUnread }
}

function App() {
  const [items] = createSignal([
    message(1, "Ryan", "Solid 2.0 rc", "Queued writes landed. Flush is explicit now.", true),
    message(2, "Bench", "JFB keyed table", "Create, update, swap, clear. Same jumbotron DOM.", true),
    message(3, "Lil", "LSX templates", "cloneTemplate for rows, same as Solid's JSX output.", false),
    message(4, "Runtime", "Dispose recycle", "Drop row closures from the effect free list.", true),
    message(5, "Site", "Paired demos", "Every example is Solid JSX next to LSX.", false),
  ])
  const [selectedId, setSelectedId] = createSignal(1)
  const [unreadOnly, setUnreadOnly] = createSignal(false)

  const visible = createMemo(() => {
    const all = items()
    if (!unreadOnly()) return all
    return all.filter((item) => item.unread())
  })
  const selected = createMemo(() => items().find((item) => item.id === selectedId()) ?? null)
  const unreadCount = createMemo(() => items().filter((item) => item.unread()).length)

  return (
    <div class="stack">
      <h2>Inbox</h2>
      <p class="muted">{unreadCount()} unread. Selecting a message marks it read. Filter is a memo over per-row unread signals.</p>
      <div class="row">
        <button class="primary" onClick={() => setUnreadOnly(false)}>All</button>
        <button onClick={() => setUnreadOnly(true)}>Unread</button>
      </div>
      <div class="inbox">
        <div>
          <For each={visible()}>
            {(item) => (
              <button
                class={`mail-row${selectedId() === item.id ? " sel" : ""}`}
                onClick={() => {
                  setSelectedId(item.id)
                  item.setUnread(false)
                }}
              >
                <strong>{item.from}</strong>
                <span class={item.unread() ? "" : "muted"}>{item.subject}</span>
              </button>
            )}
          </For>
        </div>
        <Show when={selected()} fallback={<p class="muted">No message</p>}>
          {(item) => (
            <div class="card">
              <h3>{item().subject}</h3>
              <p class="muted">{item().from}</p>
              <p>{item().body}</p>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}

render(() => <App />, document.getElementById("app"))
