import { For, Show, createSignal } from "solid-js"
import { render } from "@solidjs/web"

function card(id, title, lane) {
  const [current, setLane] = createSignal(lane)
  return { id, title, lane: current, setLane }
}

function App() {
  let nextId = 6
  const [cards, setCards] = createSignal([
    card(1, "Port For", "todo"),
    card(2, "Selector notify", "todo"),
    card(3, "JFB clear", "todo"),
    card(4, "Dispose leak", "doing"),
    card(5, "Package graph", "done"),
  ])

  return (
    <div class="stack">
      <h2>Kanban</h2>
      <p class="muted">One keyed list. Each card has a lane signal; columns are Show filters over the same cards.</p>
      <div class="board">
        <div class="lane">
          <h3>Todo</h3>
          <For each={cards()}>
            {(entry) => (
              <Show when={entry.lane() === "todo"}>
                <div class="card-item">
                  <span>{entry.title}</span>
                  <button onClick={() => entry.setLane("doing")}>Start</button>
                </div>
              </Show>
            )}
          </For>
          <button
            class="primary"
            onClick={() => {
              const id = nextId++
              setCards([...cards(), card(id, `Card ${id}`, "todo")])
            }}
          >
            Add
          </button>
        </div>
        <div class="lane">
          <h3>Doing</h3>
          <For each={cards()}>
            {(entry) => (
              <Show when={entry.lane() === "doing"}>
                <div class="card-item">
                  <span>{entry.title}</span>
                  <div class="row">
                    <button onClick={() => entry.setLane("todo")}>Back</button>
                    <button onClick={() => entry.setLane("done")}>Done</button>
                  </div>
                </div>
              </Show>
            )}
          </For>
        </div>
        <div class="lane">
          <h3>Done</h3>
          <For each={cards()}>
            {(entry) => (
              <Show when={entry.lane() === "done"}>
                <div class="card-item">
                  <span>{entry.title}</span>
                  <button onClick={() => entry.setLane("doing")}>Reopen</button>
                </div>
              </Show>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}

render(() => <App />, document.getElementById("app"))
