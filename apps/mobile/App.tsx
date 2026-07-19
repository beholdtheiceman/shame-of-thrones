import { useEffect } from "react";
import { DarkTheme, NavigationContainer, type Theme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { configureGoogle, getToken } from "./lib/auth";
import { registerForPush } from "./lib/push";
import { StoreProvider } from "./lib/store";
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

export default function App() {
  useEffect(() => {
    configureGoogle();
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
        <NavigationContainer theme={navTheme}>
          <Tab.Navigator
            screenOptions={{
              headerShown: false,
              tabBarActiveTintColor: COLORS.brass,
              tabBarInactiveTintColor: COLORS.inkFaint,
              tabBarStyle: { backgroundColor: COLORS.vellumRaised, borderTopColor: COLORS.vellumLine },
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
