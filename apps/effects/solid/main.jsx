import { createEffect, createSignal } from "solid-js"
import { render } from "@solidjs/web"

function App() {
  const [ticks, setTicks] = createSignal(0)
  const [title, setTitle] = createSignal("idle")

  createEffect(
    () => ticks(),
    (value) => {
      setTitle(`ticks ${value}`)
    },
  )

  return (
    <div class="stack">
      <h2>Split effects</h2>
      <button class="primary" onClick={() => setTicks((value) => value + 1)}>
        Tick {ticks()}
      </button>
      <p class="muted">Apply phase wrote: {title()}</p>
    </div>
  )
}

render(() => <App />, document.getElementById("app"))
