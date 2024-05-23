@file:Suppress("FunctionName", "ClassName", "unused", "EnumEntryName", "UnusedImport")
package com.sourcegraph.cody.protocol_generated

data class CodeActions_ProvideParams(
  val location: ProtocolLocation,
  val triggerKind: CodeActionTriggerKind, // Oneof: Invoke, Automatic
)

