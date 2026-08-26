(module
  ;; A JavaScript function cannot be inserted directly into SQLite's WASM
  ;; function table. Importing and re-exporting it gives the function the exact
  ;; WASM type required by the table. Cloudflare compiles this module at deploy
  ;; time, so creating an adapter does not compile WASM at runtime.
  (import "callbacks" "i_i" (func $i_i (param i32) (result i32)))
  (import "callbacks" "i_ii" (func $i_ii (param i32 i32) (result i32)))
  (import "callbacks" "i_ij" (func $i_ij (param i32 i64) (result i32)))
  (import "callbacks" "i_iii" (func $i_iii (param i32 i32 i32) (result i32)))
  (import "callbacks" "i_iiii" (func $i_iiii (param i32 i32 i32 i32) (result i32)))
  (import "callbacks" "i_iiij" (func $i_iiij (param i32 i32 i32 i64) (result i32)))
  (import "callbacks" "i_iiiii" (func $i_iiiii (param i32 i32 i32 i32 i32) (result i32)))
  (import "callbacks" "i_iiiiii" (func $i_iiiiii (param i32 i32 i32 i32 i32 i32) (result i32)))
  (import "callbacks" "v_i" (func $v_i (param i32)))
  (import "callbacks" "v_iii" (func $v_iii (param i32 i32 i32)))
  (import "callbacks" "v_iiiij" (func $v_iiiij (param i32 i32 i32 i32 i64)))
  (import "callbacks" "v_iiiiijj" (func $v_iiiiijj (param i32 i32 i32 i32 i32 i64 i64)))

  (export "i_i" (func $i_i))
  (export "i_ii" (func $i_ii))
  (export "i_ij" (func $i_ij))
  (export "i_iii" (func $i_iii))
  (export "i_iiii" (func $i_iiii))
  (export "i_iiij" (func $i_iiij))
  (export "i_iiiii" (func $i_iiiii))
  (export "i_iiiiii" (func $i_iiiiii))
  (export "v_i" (func $v_i))
  (export "v_iii" (func $v_iii))
  (export "v_iiiij" (func $v_iiiij))
  (export "v_iiiiijj" (func $v_iiiiijj))
)
