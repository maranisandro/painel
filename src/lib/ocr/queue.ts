/**
 * Fila com concorrência limitada pro processamento de OCR em segundo plano —
 * achado real 2026-08-19/20: subir vários tickets de uma vez (360 arquivos)
 * disparava um worker Tesseract concorrente PRA CADA arquivo, estourando
 * memória/CPU do processo Node e travando silenciosamente todos em ~5% pra
 * sempre (sem erro, sem timeout — só nunca mais atualizava). Processa no
 * máximo `MAX_CONCORRENTES` por vez, enfileirando o resto.
 */
const MAX_CONCORRENTES = 3

let emExecucao = 0
const fila: (() => void)[] = []

function proximo() {
  if (emExecucao >= MAX_CONCORRENTES) return
  const tarefa = fila.shift()
  if (!tarefa) return
  emExecucao++
  tarefa()
}

export function enfileirarOcr<T>(tarefa: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    fila.push(() => {
      tarefa()
        .then(resolve, reject)
        .finally(() => {
          emExecucao--
          proximo()
        })
    })
    proximo()
  })
}
