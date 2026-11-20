// Procesos automáticos de El Mesón en Java: existencias, reabastecimiento, recetas y merma.
// Entra por la API del sistema (mismos permisos que las pantallas) y SOLO LEE: no crea pedidos ni mueve inventario.
// Uso (Java 21, sin compilar): java Procesos.java [http://127.0.0.1:3000]
// Pide usuario y PIN de Administrador; para pruebas acepta MESON_USUARIO y MESON_PIN como variables de entorno.
import java.io.*;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.LocalDate;
import java.util.*;
import java.util.stream.*;

public class Procesos {
  static final HttpClient http = HttpClient.newHttpClient();
  static String base, cookie = "";

  public static void main(String[] args) throws Exception {
    try { correr(args); }
    catch (Falla f) { System.err.println("No se pudo: " + f.getMessage()); System.exit(1); }
  }

  static void correr(String[] args) throws Exception {
    base =args.length > 0 ? args[0].replaceAll("/+$", "") : "http://127.0.0.1:3000";
    System.out.println("El Mesón · Procesos en Java (" + base + ")");

    List<Object> usuarios = lista(pedir("GET", "/api/usuarios", null));
    String nombre = Optional.ofNullable(System.getenv("MESON_USUARIO")).orElseGet(() -> leer("Usuario administrador: ", false));
    Map<String, Object> u = usuarios.stream().map(Procesos::mapa).filter(x -> nombre.equalsIgnoreCase(txt(x.get("nombre")))).findFirst()
      .orElseThrow(() -> new Falla("No existe el usuario activo \"" + nombre + "\""));
    if (!"admin".equals(u.get("rol"))) throw new Falla("Los procesos son solo para Administración");
    String pin = Optional.ofNullable(System.getenv("MESON_PIN")).orElseGet(() -> leer("PIN: ", true));
    pedir("POST", "/api/login", "{\"usuario_id\":" + txt(u.get("id")) + ",\"pin\":" + json(pin) + "}");

    try {
      Map<String, Object> e = mapa(pedir("GET", "/api/estado", null));
      Path dir = Paths.get(System.getProperty("user.dir"), "reportes", LocalDate.now().toString());
      Files.createDirectories(dir);
      int[] r = procesar(e, dir);
      System.out.printf("%nBajo mínimo: %d (críticos: %d) · Por pedir: %d insumos de %d proveedores%n", r[0], r[1], r[2], r[3]);
      System.out.println("Reportes guardados en " + dir);
    } finally {
      pedir("POST", "/api/logout", "{}"); // no deja la sesión abierta
    }
  }

  // Devuelve [bajo mínimo, críticos, insumos por pedir, proveedores] y escribe los CSV.
  static int[] procesar(Map<String, Object> e, Path dir) throws IOException {
    List<Map<String, Object>> insumos = mapas(e.get("insumos")).stream().filter(i -> num(i.get("activo")) != 0).toList();
    Map<String, String> provs = mapas(e.get("proveedores")).stream().collect(Collectors.toMap(p -> txt(p.get("id")), p -> txt(p.get("nombre"))));
    Map<String, String> cats = mapas(e.get("categorias")).stream().collect(Collectors.toMap(c -> txt(c.get("id")), c -> txt(c.get("nombre"))));

    // 1. Existencias: mismo criterio que la pantalla (crítico bajo 1/4 del mínimo; bajo, bajo el mínimo).
    List<List<Object>> ex = new ArrayList<>();
    int bajos = 0, criticos = 0;
    for (var i : insumos) {
      String est = estado(num(i.get("stock")), num(i.get("min")));
      if (!est.equals("OK")) bajos++;
      if (est.equals("Crítico")) criticos++;
      ex.add(List.of(txt(i.get("nombre")), cats.getOrDefault(txt(i.get("categoria_id")), ""), txt(i.get("unidad")), num(i.get("stock")), num(i.get("min")), num(i.get("max")),
        est, Math.max(num(i.get("max")) - num(i.get("stock")), 0)));
    }
    csv(dir.resolve("existencias.csv"), List.of("Insumo", "Categoría", "Unidad", "Existencia", "Mínimo", "Máximo", "Estado", "Falta para el máximo"), ex);

    // 2. Reabastecimiento: bajo mínimo y sin solicitud pendiente ni pedido abierto (igual que "Solicitud sugerida").
    Set<String> enCurso = new HashSet<>();
    mapas(e.get("solicitudes")).stream().filter(s -> "pendiente".equals(s.get("estado"))).forEach(s -> mapas(s.get("lineas")).forEach(l -> enCurso.add(txt(l.get("insumo_id")))));
    mapas(e.get("pedidos")).stream().filter(p -> "en_proceso".equals(p.get("estado"))).forEach(p -> mapas(p.get("lineas")).forEach(l -> enCurso.add(txt(l.get("insumo_id")))));
    Map<String, Map<String, Object>> pres = new HashMap<>(); // la presentación vigente más grande de cada insumo
    for (var p : mapas(e.get("presentaciones"))) {
      if (num(p.get("activo")) == 0) continue;
      pres.merge(txt(p.get("insumo_id")), p, (a, b) -> num(b.get("contenido")) > num(a.get("contenido")) ? b : a);
    }
    List<List<Object>> re = new ArrayList<>();
    for (var i : insumos) {
      double stock = num(i.get("stock")), min = num(i.get("min")), max = num(i.get("max"));
      if (stock >= min || enCurso.contains(txt(i.get("id")))) continue;
      double cant = Math.max(Math.max(max - stock, min - stock), 1);
      var p = pres.get(txt(i.get("id")));
      String enPres = p == null ? "" : (long) Math.ceil(cant / num(p.get("contenido"))) + " × " + txt(p.get("nombre")) + " de " + fmt(num(p.get("contenido"))) + " " + txt(i.get("unidad"));
      re.add(List.of(provs.getOrDefault(txt(i.get("proveedor_id")), "Sin asignar"), txt(i.get("nombre")), estado(stock, min), stock, cant, txt(i.get("unidad")), enPres));
    }
    re.sort(Comparator.comparing((List<Object> f) -> (String) f.get(0)).thenComparing(f -> (String) f.get(1)));
    csv(dir.resolve("reabastecimiento.csv"), List.of("Proveedor", "Insumo", "Estado", "Existencia", "Pedir", "Unidad", "En presentación"), re);

    // 3. Recetas: costo, margen y cuántas porciones alcanzan, tal como las calcula el servidor.
    csv(dir.resolve("recetas.csv"), List.of("Receta", "Porciones", "Costo por porción", "Precio de venta", "Margen por porción", "Margen %", "Alcanza para"),
      mapas(e.get("recetas")).stream().map(r -> List.<Object>of(txt(r.get("nombre")), num(r.get("porciones")), opc(r.get("costo_porcion")), opc(r.get("precio_venta")),
        opc(r.get("margen")), opc(r.get("margen_pct")), num(r.get("alcanza")))).toList());

    // 4. Merma de los últimos 30 días: prevista por recetas contra adicional registrada.
    csv(dir.resolve("merma.csv"), List.of("Insumo", "Unidad", "Prevista", "Adicional"),
      mapas(e.get("merma")).stream().map(m -> List.<Object>of(txt(m.get("nombre")), txt(m.get("unidad")), num(m.get("prevista")), num(m.get("adicional")))).toList());

    return new int[] { bajos, criticos, re.size(), (int) re.stream().map(f -> f.get(0)).distinct().count() };
  }

  static String estado(double stock, double min) { return stock < min * 0.25 ? "Crítico" : stock < min ? "Bajo" : "OK"; }

  // CSV con BOM para que Excel respete los acentos.
  static void csv(Path f, List<String> cab, List<List<Object>> filas) throws IOException {
    StringBuilder sb = new StringBuilder("﻿").append(String.join(",", cab.stream().map(Procesos::celda).toList())).append("\r\n");
    for (var fila : filas) sb.append(fila.stream().map(Procesos::celda).collect(Collectors.joining(","))).append("\r\n");
    Files.writeString(f, sb.toString(), StandardCharsets.UTF_8);
  }

  static String celda(Object v) {
    String s = v instanceof Double d ? fmt(d) : String.valueOf(v);
    if (!s.isEmpty() && "=+-@".indexOf(s.charAt(0)) >= 0 && !(v instanceof Double)) s = "'" + s; // evita fórmulas en Excel
    return s.matches(".*[\",\\r\\n].*") ? "\"" + s.replace("\"", "\"\"") + "\"" : s;
  }

  static String fmt(double d) { return new BigDecimal(Math.round(d * 1000) / 1000.0).setScale(3, java.math.RoundingMode.HALF_UP).stripTrailingZeros().toPlainString(); }
  static Object opc(Object v) { return v == null ? "Sin dato" : num(v); }

  static String leer(String msj, boolean oculto) {
    Console c = System.console();
    if (c == null) throw new Falla("Ejecuta desde una terminal o define MESON_USUARIO y MESON_PIN");
    return oculto ? new String(c.readPassword(msj)) : c.readLine(msj).trim();
  }

  static Object pedir(String metodo, String ruta, String cuerpo) {
    try {
      var b = HttpRequest.newBuilder(URI.create(base + ruta)).header("Content-Type", "application/json");
      if (!cookie.isEmpty()) b.header("Cookie", cookie);
      b.method(metodo, cuerpo == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(cuerpo));
      HttpResponse<String> r = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
      r.headers().firstValue("set-cookie").ifPresent(c -> cookie = c.split(";", 2)[0]);
      Object d = r.body().isBlank() ? null : new Json(r.body()).valor();
      if (r.statusCode() >= 400) throw new Falla(d instanceof Map<?, ?> m && m.get("error") != null ? txt(m.get("error")) : "Error " + r.statusCode() + " en " + ruta);
      return d;
    } catch (IOException | InterruptedException x) {
      throw new Falla("No se pudo conectar con " + base + ". ¿Está encendido el sistema?");
    }
  }

  @SuppressWarnings("unchecked") static Map<String, Object> mapa(Object o) { return (Map<String, Object>) o; }
  @SuppressWarnings("unchecked") static List<Object> lista(Object o) { return o == null ? List.of() : (List<Object>) o; }
  static List<Map<String, Object>> mapas(Object o) { return lista(o).stream().map(Procesos::mapa).toList(); }
  static double num(Object o) { return o == null ? 0 : o instanceof Double d ? d : o instanceof Boolean b ? (b ? 1 : 0) : Double.parseDouble(o.toString()); }
  static String txt(Object o) { return o == null ? "" : o instanceof Double d && d == Math.floor(d) && !Double.isInfinite(d) ? String.valueOf(d.longValue()) : o.toString(); }
  static String json(String s) { return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""; }

  static class Falla extends RuntimeException { Falla(String m) { super(m); } }

  // Lector JSON mínimo (objetos, listas, texto, números, true/false/null): evita depender de librerías externas.
  static class Json {
    final String s; int i;
    Json(String s) { this.s = s; }
    Object valor() {
      espacio();
      char c = s.charAt(i);
      if (c == '{') { i++; Map<String, Object> m = new LinkedHashMap<>(); espacio(); if (s.charAt(i) == '}') { i++; return m; }
        while (true) { espacio(); String k = texto(); espacio(); i++; m.put(k, valor()); espacio(); if (s.charAt(i++) == '}') return m; } }
      if (c == '[') { i++; List<Object> l = new ArrayList<>(); espacio(); if (s.charAt(i) == ']') { i++; return l; }
        while (true) { l.add(valor()); espacio(); if (s.charAt(i++) == ']') return l; } }
      if (c == '"') return texto();
      if (s.startsWith("true", i)) { i += 4; return true; }
      if (s.startsWith("false", i)) { i += 5; return false; }
      if (s.startsWith("null", i)) { i += 4; return null; }
      int a = i; while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
      return Double.parseDouble(s.substring(a, i));
    }
    String texto() {
      StringBuilder b = new StringBuilder(); i++;
      for (char c; (c = s.charAt(i++)) != '"'; ) {
        if (c != '\\') { b.append(c); continue; }
        char e = s.charAt(i++);
        switch (e) {
          case 'n' -> b.append('\n'); case 't' -> b.append('\t'); case 'r' -> b.append('\r'); case 'b' -> b.append('\b'); case 'f' -> b.append('\f');
          case 'u' -> { b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; }
          default -> b.append(e);
        }
      }
      return b.toString();
    }
    void espacio() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }
  }
}
