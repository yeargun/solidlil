import { For, Show, createMemo, createSignal, type Accessor, type Setter } from "solid-js"
import { render } from "@solidjs/web"

type Category = "runtime" | "editor" | "lab"

type Product = {
  id: number
  name: string
  blurb: string
  category: Category
  price: number
}

type Line = {
  id: number
  name: string
  price: number
  qty: Accessor<number>
  setQty: Setter<number>
}

const catalog: Product[] = [
  { id: 1, name: "Signals core", blurb: "Queued writes, flush, split effects.", category: "runtime", price: 12 },
  { id: 2, name: "LSX templates", blurb: "cloneNode rows, same as Solid JSX.", category: "editor", price: 18 },
  { id: 3, name: "For / Repeat", blurb: "Keyed list reconcile.", category: "runtime", price: 9 },
  { id: 4, name: "Piece tree", blurb: "Buffer used by the Monaco port.", category: "editor", price: 28 },
  { id: 5, name: "JFB harness", blurb: "Official keyed jumbotron table.", category: "lab", price: 6 },
  { id: 6, name: "Closed-world cfg", blurb: "Delete unused runtime per app.", category: "lab", price: 14 },
  { id: 7, name: "Selector notify", blurb: "Wake two rows, not a thousand.", category: "runtime", price: 11 },
  { id: 8, name: "Store draft", blurb: "Mutate, then flush.", category: "runtime", price: 16 },
]

const filters: Array<{ id: 0 | 1 | 2 | 3; label: string; category: Category | "all" }> = [
  { id: 0, label: "All", category: "all" },
  { id: 1, label: "Runtime", category: "runtime" },
  { id: 2, label: "Editor", category: "editor" },
  { id: 3, label: "Lab", category: "lab" },
]

function makeLine(product: Product): Line {
  const [qty, setQty] = createSignal(1)
  return { id: product.id, name: product.name, price: product.price, qty, setQty }
}

function App() {
  const [query, setQuery] = createSignal("")
  const [filter, setFilter] = createSignal(0)
  const [cart, setCart] = createSignal<Line[]>([])

  const visible = createMemo(() => {
    const needle = query().trim().toLowerCase()
    const selected = filters[filter()]?.category ?? "all"
    return catalog.filter((product) => {
      if (selected !== "all" && product.category !== selected) return false
      if (!needle) return true
      return `${product.name} ${product.blurb}`.toLowerCase().includes(needle)
    })
  })

  const count = createMemo(() => cart().reduce((sum, line) => sum + line.qty(), 0))
  const total = createMemo(() => cart().reduce((sum, line) => sum + line.price * line.qty(), 0))

  function add(product: Product) {
    const existing = cart().find((line) => line.id === product.id)
    if (existing) {
      existing.setQty((value) => value + 1)
      return
    }
    setCart((current) => [...current, makeLine(product)])
  }

  return (
    <div class="stack market">
      <div>
        <h2>Lil marketplace</h2>
        <p class="muted">Catalog, category chips, search memo, and a keyed cart. TypeScript Solid 2.0 on the left, LSX on the right.</p>
        <div class="row">
          <input
            placeholder="Search kits"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
        <div class="row">
          <For each={filters}>
            {(item) => (
              <button
                class={filter() === item.id ? "primary" : ""}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>
        <div class="market-grid">
          <For each={visible()}>
            {(product) => (
              <div class="product">
                <span class="muted">{product.category}</span>
                <strong>{product.name}</strong>
                <span>{product.blurb}</span>
                <div class="row">
                  <span class="price">${product.price}</span>
                  <button class="primary" onClick={() => add(product)}>Add</button>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
      <div class="card cart">
        <h3>Cart · {count()}</h3>
        <Show when={cart().length > 0} fallback={<p class="muted">Empty. Add a kit.</p>}>
          <For each={cart()}>
            {(line) => (
              <div class="todo-item">
                <span>{line.name}</span>
                <button onClick={() => line.setQty((value) => Math.max(0, value - 1))}>-</button>
                <strong>{line.qty()}</strong>
                <button onClick={() => line.setQty((value) => value + 1)}>+</button>
              </div>
            )}
          </For>
          <p>Total ${total()}</p>
        </Show>
      </div>
    </div>
  )
}

render(() => <App />, document.getElementById("app")!)
