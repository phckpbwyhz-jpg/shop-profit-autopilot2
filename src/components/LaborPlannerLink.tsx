import { router } from 'expo-router';
import { Pressable,StyleSheet,Text } from 'react-native';
export function LaborPlannerLink(){return <Pressable style={styles.button} onPress={()=>router.push('/labor-planner')}><Text style={styles.text}>Open Labor Planner + What-If →</Text></Pressable>}
const styles=StyleSheet.create({button:{padding:13,borderRadius:10,backgroundColor:'#eaf2ff',alignItems:'center'},text:{color:'#1769e0',fontWeight:'900'}});
