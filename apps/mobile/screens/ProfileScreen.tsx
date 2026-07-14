import { StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { COLORS } from "../lib/theme";

// Placeholder — built out in Phase 4 Sub-project 3.
export default function ProfileScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.text}>Profile — Sub-project 3</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.vellum },
  text: { color: COLORS.inkSoft, fontSize: 16 },
});
