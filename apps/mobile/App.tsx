import { useEffect } from "react";
import { View } from "react-native";
import { DarkTheme, NavigationContainer, type Theme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { configureGoogle, getToken } from "./lib/auth";
import { registerForPush } from "./lib/push";
import { configurePurchases, identifyUser } from "./lib/purchases";
import { StoreProvider, useStore } from "./lib/store";
import { COLORS } from "./lib/theme";
import RealmScreen from "./screens/RealmScreen";
import StandingsScreen from "./screens/StandingsScreen";
import ProfileScreen from "./screens/ProfileScreen";
import TreasuryScreen from "./screens/TreasuryScreen";

const Tab = createBottomTabNavigator();

const navTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: COLORS.brass,
    background: COLORS.vellum,
    card: COLORS.vellumRaised,
    text: COLORS.ink,
    border: COLORS.vellumLine,
    notification: COLORS.crimson,
  },
};

// Identifies the signed-in user to RevenueCat once their id is known. Lives
// inside StoreProvider (it needs useStore) — App() itself renders
// StoreProvider, so this effect can't live there. No-ops when RevenueCat
// isn't configured (see lib/purchases.ts).
function RevenueCatIdentity() {
  const { state } = useStore();
  const userId = state.profile?.id ?? null;
  useEffect(() => {
    if (userId) void identifyUser(userId);
  }, [userId]);
  return null;
}

export default function App() {
  useEffect(() => {
    configureGoogle();
    configurePurchases();
    // App-ready push registration for a returning, already-signed-in user
    // (the post-sign-in registration lives in the sign-in handlers). Both
    // are fire-and-forget and soft-fail — see lib/push.ts.
    void (async () => {
      const token = await getToken().catch(() => null);
      if (token) void registerForPush();
    })();
  }, []);

  return (
    <SafeAreaProvider>
      <StoreProvider>
        <RevenueCatIdentity />
        <NavigationContainer theme={navTheme}>
          <Tab.Navigator
            screenOptions={{
              headerShown: false,
              tabBarActiveTintColor: COLORS.brass,
              tabBarInactiveTintColor: COLORS.inkFaint,
              tabBarStyle: { backgroundColor: COLORS.vellumRaised, borderTopColor: COLORS.vellumLine },
              // View-based icon (no font glyph) so it always renders — the tabs
              // had no icon, which showed as a .notdef box on iOS.
              tabBarIcon: ({ color }) => (
                <View style={{ width: 14, height: 14, backgroundColor: color }} />
              ),
            }}
          >
            <Tab.Screen name="Realm" component={RealmScreen} />
            <Tab.Screen name="Standings" component={StandingsScreen} />
            <Tab.Screen name="Profile" component={ProfileScreen} />
            <Tab.Screen name="Treasury" component={TreasuryScreen} />
          </Tab.Navigator>
        </NavigationContainer>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
