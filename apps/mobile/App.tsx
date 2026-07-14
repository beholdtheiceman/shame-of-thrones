import { useEffect } from "react";
import { DarkTheme, NavigationContainer, type Theme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { configureGoogle } from "./lib/auth";
import { StoreProvider } from "./lib/store";
import { COLORS } from "./lib/theme";
import RealmScreen from "./screens/RealmScreen";
import StandingsScreen from "./screens/StandingsScreen";
import ProfileScreen from "./screens/ProfileScreen";

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
          </Tab.Navigator>
        </NavigationContainer>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
