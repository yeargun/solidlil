import { For, createSignal } from "solid-js"
import { render } from "@solidjs/web"

const adjectives = ["pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain", "quaint", "clean", "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd", "unsightly", "adorable", "important", "inexpensive", "cheap", "expensive", "fancy"]
const colors = ["red", "yellow", "blue", "green", "pink", "brown", "purple", "brown", "white", "black", "orange"]
const nouns = ["table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger", "pizza", "mouse", "keyboard"]

const random = (max) => Math.round(Math.random() * 1000) % max

let nextId = 1

const buildData = (count) => {
  const data = []
  for (let i = 0; i < count; i++) {
    const [label, setLabel] = createSignal(
      `${adjectives[random(adjectives.length)]} ${colors[random(colors.length)]} ${nouns[random(nouns.length)]}`,
    )
    data[i] = { id: nextId++, label, setLabel }
  }
  return data
}

render(() => {
  const [data, setData] = createSignal([])
  const [selected, setSelected] = createSignal(0)
  const replaceRows = (count) => {
    setSelected(0)
    setData(buildData(count))
  }
  const add = () => setData((d) => d.concat(buildData(1000)))
  const update = () => {
    const rows = data()
    for (let i = 0, len = rows.length; i < len; i += 10) {
      rows[i].setLabel((label) => label + " !!!")
    }
  }
  const clear = () => {
    setSelected(0)
    setData([])
  }
  const swapRows = () =>
    setData((list) => {
      if (list.length <= 998) return list
      const next = list.slice()
      const item = next[1]
      next[1] = next[998]
      next[998] = item
      return next
    })

  return (
    <div class="container">
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6">
            <h1>Solid 2.0</h1>
          </div>
          <div class="col-md-6">
            <div class="row">
              <div class="col-sm-6 smallpad">
                <button
                  id="run"
                  class="btn btn-primary btn-block"
                  type="button"
                  onClick={() => replaceRows(1000)}
                >
                  Create 1,000 rows
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  id="runlots"
                  class="btn btn-primary btn-block"
                  type="button"
                  onClick={() => replaceRows(10000)}
                >
                  Create 10,000 rows
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button id="add" class="btn btn-primary btn-block" type="button" onClick={add}>
                  Append 1,000 rows
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button id="update" class="btn btn-primary btn-block" type="button" onClick={update}>
                  Update every 10th row
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button id="clear" class="btn btn-primary btn-block" type="button" onClick={clear}>
                  Clear
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button id="swaprows" class="btn btn-primary btn-block" type="button" onClick={swapRows}>
                  Swap Rows
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <table class="table table-hover table-striped test-data">
        <tbody>
          <For each={data()}>
            {(row) => {
              const rowId = row.id
              return (
                <tr class={{ danger: selected() === rowId }}>
                  <td class="col-md-1" textContent={rowId} />
                  <td class="col-md-4">
                    <a onClick={() => setSelected(rowId)} textContent={row.label()} />
                  </td>
                  <td class="col-md-1">
                    <a
                      onClick={() => {
                        if (selected() === rowId) setSelected(0)
                        setData((rows) => rows.filter((item) => item.id !== rowId))
                      }}
                    >
                      <span class="glyphicon glyphicon-remove" aria-hidden="true" />
                    </a>
                  </td>
                  <td class="col-md-6" />
                </tr>
              )
            }}
          </For>
        </tbody>
      </table>
      <span class="preloadicon glyphicon glyphicon-remove" aria-hidden="true" />
    </div>
  )
}, document.getElementById("main"))
